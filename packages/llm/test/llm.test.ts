import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createProviders, pickProvider } from "../src/factory.js";
import {
  buildEnrichmentPrompt,
  buildExtractionPrompt,
  buildReviewPrompt,
  HARD_RULES,
} from "../src/prompts.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { groqProvider } from "../src/providers/openaiCompat.js";
import { EnrichmentResult, ReviewResult } from "../src/schemas.js";
import {
  completeStructured,
  extractJson,
  repairTruncatedJson,
  StructuredOutputError,
} from "../src/structured.js";
import { fetchStub, MockProvider } from "./helpers.js";

describe("providers build correct requests and parse responses", () => {
  it("ollama", async () => {
    const { fn, calls } = fetchStub([{ body: { message: { content: "hi" } } }]);
    const p = new OllamaProvider({ fetch: fn, model: "m1" });
    const res = await p.complete({ system: "s", user: "u", json: true });
    expect(res).toEqual({ text: "hi", provider: "ollama", model: "m1" });
    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.format).toBe("json");
    expect(body.messages[0]).toEqual({ role: "system", content: "s" });
  });

  it("gemini", async () => {
    const { fn, calls } = fetchStub([
      { body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const p = new GeminiProvider({ apiKey: "k", fetch: fn });
    const res = await p.complete({ system: "s", user: "u", json: true });
    expect(res.text).toBe("ok");
    expect(calls[0]?.url).toContain("generativelanguage.googleapis.com");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("groq (openai-compatible)", async () => {
    const { fn, calls } = fetchStub([{ body: { choices: [{ message: { content: "g" } }] } }]);
    const p = groqProvider({ apiKey: "k", fetch: fn });
    const res = await p.complete({ system: "s", user: "u", json: true });
    expect(res.text).toBe("g");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0]?.init.body)).response_format.type).toBe("json_object");
  });

  it("anthropic sends the browser-access header", async () => {
    const { fn, calls } = fetchStub([{ body: { content: [{ type: "text", text: "a" }] } }]);
    const p = new AnthropicProvider({ apiKey: "k", fetch: fn });
    const res = await p.complete({ system: "s", user: "u" });
    expect(res.text).toBe("a");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe("k");
  });

  it("throws ProviderError with status on failure", async () => {
    const { fn } = fetchStub([{ status: 429, body: { error: "rate limited" } }]);
    const p = groqProvider({ apiKey: "k", fetch: fn });
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      status: 429,
    });
  });
});

describe("availability and provider order", () => {
  it("key-based providers report availability from config", async () => {
    expect(await new GeminiProvider({}).available()).toBe(false);
    expect(await new GeminiProvider({ apiKey: "k" }).available()).toBe(true);
  });

  it("ollama availability follows reachability", async () => {
    const up = new OllamaProvider({ fetch: fetchStub([{ body: {} }]).fn });
    expect(await up.available()).toBe(true);
    const down = new OllamaProvider({
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(await down.available()).toBe(false);
  });

  it("createProviders returns free-first order; pickProvider takes first available", async () => {
    const failFetch = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(createProviders().map((p) => p.id)).toEqual([
      "ollama",
      "gemini",
      "groq",
      "openrouter",
      "anthropic",
    ]);
    const picked = await pickProvider({ fetch: failFetch, groqApiKey: "k" });
    expect(picked?.id).toBe("groq");
    expect(await pickProvider({ fetch: failFetch })).toBeNull();
  });

  it("includeLocal (D-049/D-052) prepends on-device inference and wins automatically", async () => {
    // opt-in only: callers who don't set it (the CLI, pnpm eval) are unaffected.
    expect(createProviders({ includeLocal: true }).map((p) => p.id)).toEqual([
      "local",
      "ollama",
      "gemini",
      "groq",
      "openrouter",
      "anthropic",
    ]);
    // local's available() is unconditionally true, so it wins even over a
    // configured key: on-device leads once the user opts in.
    const picked = await pickProvider({ includeLocal: true, groqApiKey: "k" });
    expect(picked?.id).toBe("local");
  });
});

describe("completeStructured", () => {
  const schema = z.object({ a: z.number() });

  it("returns validated data on first try (fenced JSON ok)", async () => {
    const mock = new MockProvider(['```json\n{"a": 1}\n```']);
    expect(await completeStructured(mock, { system: "s", user: "u" }, schema)).toEqual({ a: 1 });
    expect(mock.requests).toHaveLength(1);
  });

  it("retries once with the validation error appended", async () => {
    const mock = new MockProvider(['{"a": "not-a-number"}', '{"a": 2}']);
    expect(await completeStructured(mock, { system: "s", user: "u" }, schema)).toEqual({ a: 2 });
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[1]?.user).toContain("previous response was invalid");
  });

  it("throws StructuredOutputError after two failures", async () => {
    const mock = new MockProvider(["nonsense", "more nonsense"]);
    await expect(
      completeStructured(mock, { system: "s", user: "u" }, schema),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it("extractJson handles bare, fenced, and embedded payloads", () => {
    expect(extractJson('{"x":1}')).toBe('{"x":1}');
    expect(extractJson('```json\n{"x":1}\n```')).toBe('{"x":1}');
    expect(extractJson('Here you go: {"x":1}')).toBe('{"x":1}');
  });

  it("salvages complete array elements from a truncated response instead of retrying (D-068)", async () => {
    const enrichmentSchema = z.object({
      enrichments: z.array(z.object({ id: z.string(), why: z.string().optional() })),
    });
    // Mirrors a real token-budget cutoff mid-way through the third element.
    const truncated =
      '{"enrichments":[{"id":"a","why":"first"},{"id":"b","why":"second"},{"id":"c","why":"cut off mid-str';
    const mock = new MockProvider([truncated]);
    const result = await completeStructured(mock, { system: "s", user: "u" }, enrichmentSchema);
    expect(result.enrichments).toEqual([
      { id: "a", why: "first" },
      { id: "b", why: "second" },
    ]);
    // Salvage succeeded on the first attempt — no retry call spent.
    expect(mock.requests).toHaveLength(1);
  });
});

describe("repairTruncatedJson", () => {
  it("closes a truncated array, dropping the incomplete last element", () => {
    const truncated = '{"enrichments":[{"id":"a"},{"id":"b"},{"id":"c","why":"cut off mid';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired as string)).toEqual({
      enrichments: [{ id: "a" }, { id: "b" }],
    });
  });

  it("returns null when truncation happens before any element ever completed", () => {
    expect(repairTruncatedJson('{"enrichments":[{"id":"a')).toBeNull();
  });

  it("is unfooled by a brace/bracket character inside a string value", () => {
    const truncated =
      '{"enrichments":[{"id":"a","why":"contains } and ] chars"},{"id":"b","why":"cut';
    const repaired = repairTruncatedJson(truncated);
    expect(JSON.parse(repaired as string)).toEqual({
      enrichments: [{ id: "a", why: "contains } and ] chars" }],
    });
  });
});

describe("prompts", () => {
  it("both prompts carry the hard never-fabricate rules", () => {
    const ex = buildExtractionPrompt({ sections: [{ heading: "Education", text: "B.S. CS" }] });
    const doc = {
      basics: { name: "A", profiles: [] },
      work: [],
      education: [],
      skills: [],
      projects: [],
      awards: [],
      certificates: [],
      languages: [],
      meta: {
        sourceFormat: "pdf" as const,
        texSourceMap: [],
        regionSignals: {
          hasPhoto: false,
          hasDateOfBirth: false,
          hasMaritalStatus: false,
          hasNationality: false,
          hasDeclarationLine: false,
          spellingVariant: "unknown" as const,
        },
      },
    };
    const rev = buildReviewPrompt({
      resume: doc,
      context: { region: "us", role: "swe-intern", jobDescription: "We need Go engineers" },
      packInstructions: ["prefer formal tone for German applications"],
    });
    const enr = buildEnrichmentPrompt({
      resume: doc,
      context: { region: "us", role: "swe-intern" },
      findings: [
        {
          id: "stu-quantify",
          layer: "impact",
          priority: "P1",
          title: "Quantify your bullet points",
          evidence: "worked on backend",
          why: "no metric",
          source: "rulepack:stage/student#stu-quantify",
        },
      ],
    });
    for (const prompt of [ex, rev, enr]) {
      expect(prompt.system).toContain("NEVER invent facts");
      expect(prompt.system).toContain(HARD_RULES.split("\n")[1]);
    }
    expect(ex.user).toContain("## Education");
    expect(rev.user).toContain("role=swe-intern");
    expect(rev.user).toContain("We need Go engineers");
    expect(rev.user).toContain("formal tone");
    expect(rev.system).toContain('There is no "ATS auto-reject"');
  });

  it("buildEnrichmentPrompt (D-056/O-20) carries the given finding ids and forbids inventing new ones", () => {
    const prompt = buildEnrichmentPrompt({
      resume: {
        basics: { name: "A", profiles: [] },
        work: [],
        education: [],
        skills: [],
        projects: [],
        awards: [],
        certificates: [],
        languages: [],
        meta: {
          sourceFormat: "pdf" as const,
          texSourceMap: [],
          regionSignals: {
            hasPhoto: false,
            hasDateOfBirth: false,
            hasMaritalStatus: false,
            hasNationality: false,
            hasDeclarationLine: false,
            spellingVariant: "unknown" as const,
          },
        },
      },
      context: { region: "us", role: "swe-intern" },
      findings: [
        {
          id: "stu-quantify",
          layer: "impact",
          priority: "P1",
          title: "Quantify your bullet points",
          evidence: "worked on backend",
          why: "no metric",
          source: "rulepack:stage/student#stu-quantify",
        },
      ],
    });
    expect(prompt.system).toContain("do not invent findings");
    expect(prompt.system).toContain("Never invent a new finding or a new id");
    expect(prompt.user).toContain("stu-quantify");
  });

  it("EnrichmentResult schema accepts a well-formed enrichment", () => {
    expect(() =>
      EnrichmentResult.parse({
        enrichments: [
          {
            id: "stu-quantify",
            why: "richer explanation grounded in the same evidence",
            suggestion: { before: "worked on backend", after: "Built the backend API" },
          },
        ],
      }),
    ).not.toThrow();
    // an enrichment may legitimately skip why/suggestion entirely
    expect(() => EnrichmentResult.parse({ enrichments: [{ id: "stu-quantify" }] })).not.toThrow();
  });

  it("ReviewResult schema accepts a well-formed review", () => {
    expect(() =>
      ReviewResult.parse({
        scores: { findability: 70, impact: 55 },
        findings: [
          {
            layer: "impact",
            priority: "P1",
            title: "Bullet states duty, not outcome",
            evidence: "worked on backend",
            why: "no outcome",
            suggestion: { before: "worked on backend", after: "Built the backend API" },
          },
        ],
      }),
    ).not.toThrow();
  });
});
