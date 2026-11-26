import { describe, expect, it } from "vitest";
import { candidateLogin, enrichGithub, parseRepoUrl } from "../src/enrich/github.js";
import { ResumeDoc } from "../src/resume.js";

function fetchStub(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = [];
  const fn = (async (url: URL | RequestInfo) => {
    const u = String(url);
    calls.push(u);
    const hit = Object.entries(routes).find(([suffix]) => u.includes(suffix));
    const res = hit?.[1] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const doc = ResumeDoc.parse({
  basics: {
    name: "T",
    profiles: [{ network: "GitHub", url: "https://github.com/tester" }],
  },
  projects: [
    { name: "shardkv", githubUrl: "https://github.com/tester/shardkv" },
    { name: "nolink" },
  ],
  meta: { sourceFormat: "builder" },
});

describe("url parsing", () => {
  it("parses repo and profile urls", () => {
    expect(parseRepoUrl("https://github.com/a/b")).toEqual({ owner: "a", repo: "b" });
    expect(parseRepoUrl("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseRepoUrl("https://example.com/a/b")).toBeNull();
    expect(candidateLogin(doc)).toBe("tester");
  });
});

describe("enrichGithub", () => {
  it("fills enrichment from repo, languages, and contributors", async () => {
    const { fn } = fetchStub({
      "/repos/tester/shardkv/languages": { body: { Go: 9000, Makefile: 100 } },
      "/repos/tester/shardkv/contributors": {
        body: [
          { login: "tester", contributions: 180 },
          { login: "other", contributions: 15 },
        ],
      },
      "/repos/tester/shardkv": {
        body: { stargazers_count: 42, pushed_at: "2026-05-14T10:00:00Z" },
      },
    });
    const { doc: out, notes } = await enrichGithub(doc, { fetch: fn });
    expect(out.projects[0]?.enrichment).toEqual({
      stars: 42,
      lastActivity: "2026-05",
      languages: ["Go", "Makefile"],
      totalCommits: 195,
      candidateCommits: 180,
    });
    expect(out.projects[1]?.enrichment).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it("skips with a note on rate limit and keeps the project untouched", async () => {
    const { fn } = fetchStub({
      "/repos/tester/shardkv": { status: 403, body: { message: "rate limit" } },
    });
    const { doc: out, notes } = await enrichGithub(doc, { fetch: fn });
    expect(out.projects[0]?.enrichment).toBeUndefined();
    expect(notes[0]).toContain("rate limit");
  });

  it("notes when the candidate is not a contributor", async () => {
    const { fn } = fetchStub({
      "/repos/tester/shardkv/languages": { body: {} },
      "/repos/tester/shardkv/contributors": { body: [{ login: "sombody-else", contributions: 3 }] },
      "/repos/tester/shardkv": { body: { stargazers_count: 1, pushed_at: "2026-01-02T00:00:00Z" } },
    });
    const { doc: out, notes } = await enrichGithub(doc, { fetch: fn });
    expect(out.projects[0]?.enrichment?.candidateCommits).toBeUndefined();
    expect(notes[0]).toContain("not among the repo's contributors");
  });

  it("sends the PAT when provided and survives network errors", async () => {
    let auth: string | undefined;
    const fn = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)?.authorization;
      throw new Error("offline");
    }) as typeof fetch;
    const { doc: out, notes } = await enrichGithub(doc, { fetch: fn, pat: "tok" });
    expect(auth).toBe("Bearer tok");
    expect(out.projects[0]?.enrichment).toBeUndefined();
    expect(notes[0]).toContain("enrichment failed");
  });
});
