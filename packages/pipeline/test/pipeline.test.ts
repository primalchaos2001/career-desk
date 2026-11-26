import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompletionRequest, CompletionResult, LlmProvider, ProviderId } from "@tailorats/llm";
import { loadPack } from "@tailorats/rules/node";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

class MockProvider implements LlmProvider {
  readonly id: ProviderId;
  readonly requests: CompletionRequest[] = [];
  private queue: string[];
  constructor(responses: string[], id: ProviderId = "ollama") {
    this.queue = [...responses];
    this.id = id;
  }
  async available() {
    return true;
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(req);
    const text = this.queue.shift();
    if (text === undefined) throw new Error("queue empty");
    return { text, provider: this.id, model: "mock" };
  }
}

const packs = [loadPack("stage/student"), loadPack("role/swe-intern"), loadPack("region/us")];
const context = { region: "us", role: "swe-intern", stage: "student" };

const TEX = readFileSync(join(__dirname, "../../evals/golden/tex/jakes-clean-swe.tex"), "utf8");
const PDF = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "../../core/test/fixtures/pdf", name)));

const REVIEW_JSON = JSON.stringify({
  scores: { findability: 70, impact: 60 },
  findings: [
    {
      layer: "impact",
      priority: "P1",
      title: "Bullet states a duty, not an outcome",
      evidence: "Developed a backend feature using Python and Django.",
      why: "No measurable result",
      suggestion: { before: "Developed a backend feature", after: "Shipped a backend feature" },
    },
  ],
});

describe("analyze: .tex path", () => {
  it("full mode merges context + llm findings with llm scores, no fidelity score", async () => {
    const provider = new MockProvider([REVIEW_JSON]);
    const { report, doc, notes } = await analyze({
      source: { kind: "tex", source: TEX },
      context,
      packs,
      llm: { provider },
    });
    expect(doc.basics.name).toBe("Avery Chen");
    expect(report.degraded).toBe(false);
    expect(report.scores).toEqual({ findability: 70, impact: 60 });
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain("stu-coursework"); // deterministic context finding
    expect(ids).toContain("llm-impact-01");
    expect(report.findings.find((f) => f.id === "llm-impact-01")?.source).toBe("llm");
    expect(notes).toEqual([]);
    // review prompt received the parsed resume, not raw tex
    expect(provider.requests[0]?.user).toContain('"Avery Chen"');
  });

  it("degraded mode yields deterministic scores + findings, no llm (D-039)", async () => {
    const { report } = await analyze({ source: { kind: "tex", source: TEX }, context, packs });
    expect(report.degraded).toBe(true);
    // D-039: the deterministic engine now scores findability + impact + overall
    // + per-section even with no LLM key.
    expect(typeof report.scores.findability).toBe("number");
    expect(typeof report.scores.impact).toBe("number");
    expect(typeof report.overall).toBe("number");
    expect(report.sections?.experience).toBeTypeOf("number");
    expect(report.findings.map((f) => f.id)).toContain("stu-coursework");
    expect(report.findings.every((f) => f.source !== "llm")).toBe(true);
  });

  it("a chosen provider whose review call throws degrades gracefully, not a crash (D-050/D-052)", async () => {
    const provider = new MockProvider([]); // empty queue → complete() throws on first call
    const { report, notes } = await analyze({
      source: { kind: "tex", source: TEX },
      context,
      packs,
      llm: { provider },
    });
    expect(report.degraded).toBe(true);
    expect(report.findings.every((f) => f.source !== "llm")).toBe(true);
    // deterministic scores still present — the failure didn't take the whole report down
    expect(typeof report.scores.findability).toBe("number");
    expect(notes.some((n) => n.includes("AI review failed"))).toBe(true);
  });

  it("provider.id === 'local' (D-056/D-057, O-20): enriches existing findings by id, adds none, deterministic scores stay authoritative", async () => {
    const enrichmentJson = JSON.stringify({
      enrichments: [
        {
          id: "stu-coursework",
          why: "richer explanation grounded in the same evidence",
          suggestion: { before: "b", after: "a" },
        },
        { id: "not-a-real-finding-id", why: "must be ignored, never trust a model-supplied id" },
      ],
    });
    const provider = new MockProvider([enrichmentJson], "local");
    const { report } = await analyze({
      source: { kind: "tex", source: TEX },
      context,
      packs,
      llm: { provider },
    });
    expect(report.degraded).toBe(false);
    const enriched = report.findings.find((f) => f.id === "stu-coursework");
    expect(enriched?.enriched).toBe(true);
    expect(enriched?.why).toBe("richer explanation grounded in the same evidence");
    expect(enriched?.suggestion).toEqual({ before: "b", after: "a" });
    // source (the rule citation) is never overwritten by an enrichment
    expect(enriched?.source).toMatch(/^rulepack:/);
    // an id the deterministic layer never produced is silently ignored, not added
    expect(report.findings.find((f) => f.id === "not-a-real-finding-id")).toBeUndefined();
    // no independent llm findings were added on the enrichment path
    expect(report.findings.every((f) => f.source !== "llm")).toBe(true);
    // deterministic scores stay authoritative — no llmScores override on this path
    expect(typeof report.scores.impact).toBe("number");
    expect(typeof report.scores.findability).toBe("number");
  });

  it("an id-only enrichment patch with no why/suggestion is a no-op, not a false 'AI-enriched' badge (D-066)", async () => {
    // The enrichment prompt explicitly permits the model to add nothing to
    // a finding it has no value to add to — this must not be indistinguishable
    // from a real enrichment in the UI.
    const enrichmentJson = JSON.stringify({ enrichments: [{ id: "stu-coursework" }] });
    const provider = new MockProvider([enrichmentJson], "local");
    const { report } = await analyze({
      source: { kind: "tex", source: TEX },
      context,
      packs,
      llm: { provider },
    });
    const untouched = report.findings.find((f) => f.id === "stu-coursework");
    expect(untouched?.enriched).toBeUndefined();
  });
});

describe("analyze: PDF path", () => {
  it("degraded PDF: fidelity score + region-signal rules fire without any LLM", async () => {
    const { report, doc, notes } = await analyze({
      source: { kind: "pdf", data: PDF("india-fresher.pdf") },
      context,
      packs,
    });
    expect(doc.basics.name).toBe("Rohan Gupta");
    expect(report.degraded).toBe(true);
    expect(report.scores.fidelity).toBeLessThanOrEqual(95); // photo image costs 5
    const ids = report.findings.map((f) => f.id);
    for (const expected of [
      "us-no-photo",
      "us-no-personal-details",
      "us-one-page",
      "us-spelling",
      "us-no-declaration",
    ]) {
      expect(ids).toContain(expected);
    }
    expect(notes[0]).toContain("No AI key");
    // D-040: a plain PDF with no LLM is now deterministically extracted, so the
    // per-section scoring runs — the report carries overall + sections.
    expect(typeof report.overall).toBe("number");
    expect(report.sections?.education).toBeTypeOf("number");
    // P0s sort before P2s
    expect(report.findings[0]?.priority).toBe("P0");
  });

  it("full PDF: extraction call then review call, extracted doc drives rules", async () => {
    const provider = new MockProvider([
      JSON.stringify({ basics: { name: "Avery Chen" } }),
      REVIEW_JSON,
    ]);
    const { report, doc } = await analyze({
      source: { kind: "pdf", data: PDF("us-clean.pdf") },
      context,
      packs,
      llm: { provider },
    });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.user).toContain("EDUCATION");
    expect(doc.basics.name).toBe("Avery Chen");
    expect(doc.meta.regionSignals.spellingVariant).toBe("en-US");
    expect(report.degraded).toBe(false);
    expect(report.scores.fidelity).toBe(100);
    // extracted doc has no projects/github → role rules fire on it
    expect(report.findings.map((f) => f.id)).toContain("swe-projects-required");
  });

  it("a chosen provider whose extraction call throws falls back to deterministic PDF parsing", async () => {
    const provider = new MockProvider([]); // empty queue → complete() throws on the extraction call
    const { report, doc, notes } = await analyze({
      source: { kind: "pdf", data: PDF("us-clean.pdf") },
      context,
      packs,
      llm: { provider },
    });
    // deterministic extraction (D-040) still produced a real doc, not an empty one
    expect(doc.basics.name).toBeTruthy();
    expect(report.scores.fidelity).toBe(100);
    expect(notes.some((n) => n.includes("AI extraction failed"))).toBe(true);
  });
});

describe("analyze: github enrichment wiring", () => {
  it("passes fetch/pat through and surfaces notes", async () => {
    const doc = (await analyze({ source: { kind: "tex", source: TEX }, context, packs })).doc;
    const docWithRepo = {
      ...doc,
      projects: [{ ...doc.projects[0], name: "p", githubUrl: "https://github.com/a/b" }],
    };
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const { notes } = await analyze({
      // biome-ignore lint/suspicious/noExplicitAny: structural fixture
      source: { kind: "resumedoc", doc: docWithRepo as any },
      context,
      packs,
      github: { fetch: failing },
    });
    expect(notes.some((n) => n.includes("enrichment failed"))).toBe(true);
  });
});
