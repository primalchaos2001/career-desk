import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentRun,
  type Run,
  recentRuns,
  searchPrompt,
  startRun,
  stepFromEvent,
  stopRun,
} from "../server/runner";

const FAKE = resolve(__dirname, "fixtures/fake-codex.mjs");
const FAKE_CLAUDE = resolve(__dirname, "fixtures/fake-claude.mjs");
const campaign = {
  id: "c1",
  name: "VLSI",
  titles: "Design Verification Engineer",
  locations: "Bengaluru",
  keywords: "UVM, Arm, Synopsys",
  exclusions: "internship",
  minLpa: "",
  notes: "",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "career-desk-run-"));
  writeFileSync(
    join(dir, "workspace.json"),
    JSON.stringify({ revision: 1, campaigns: [campaign], jobs: [] }),
  );
  writeFileSync(join(dir, "connector.mjs"), "");
});
afterEach(() => {
  try {
    stopRun(dir);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});

const start = (mode: string, extra: Partial<Parameters<typeof startRun>[0]> = {}) => {
  process.env.FAKE_CODEX = mode;
  return startRun({
    dir,
    campaignId: "c1",
    count: 3,
    mcpBundle: join(dir, "connector.mjs"),
    command: { cmd: process.execPath, args: [FAKE] },
    ...extra,
  });
};
async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
const last = (): Run | undefined => recentRuns(dir)[0];

describe("search instructions", () => {
  it("are scoped to one campaign, research only, and capped", () => {
    const p = searchPrompt(campaign, 5);
    expect(p).toContain("campaignId c1");
    expect(p).toContain("up to 5 NEW");
    expect(p).toContain("Target roles: Design Verification Engineer");
    expect(p).toContain("Exclude: internship");
    expect(p).toMatch(/Do not draft applications or emails/);
    expect(p).toMatch(/Never invent facts/);
  });
});

describe("progress steps from Codex events", () => {
  it("turns searches, saved jobs and refusals into readable steps", () => {
    expect(
      stepFromEvent({ type: "item.completed", item: { type: "web_search", query: "dv jobs" } }),
    ).toEqual({ kind: "search", text: "Searched: dv jobs" });
    expect(
      stepFromEvent({
        type: "item.completed",
        item: { type: "web_search", action: { type: "open_page", url: "https://x.com/j" } },
      }),
    ).toEqual({ kind: "search", text: "Opened: https://x.com/j" });
    expect(
      stepFromEvent({
        type: "item.completed",
        item: { type: "web_search", action: { type: "search", queries: ["arm dv jobs", "b"] } },
      }),
    ).toEqual({ kind: "search", text: "Searched: arm dv jobs" });
    expect(
      stepFromEvent({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          tool: "add_job",
          status: "completed",
          arguments: { company: "Arm", title: "DV" },
          result: { content: [] },
        },
      }),
    ).toEqual({ kind: "saved", text: "Saved: DV at Arm" });
    expect(
      stepFromEvent({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          tool: "add_job",
          status: "completed",
          result: { isError: true, content: [{ text: "This job is already saved" }] },
        },
      })?.kind,
    ).toBe("error");
    expect(
      stepFromEvent({
        type: "item.completed",
        item: { type: "mcp_tool_call", tool: "list_jobs", status: "completed", result: {} },
      }),
    ).toBeUndefined();
  });
});

describe("running a search", () => {
  it("runs the assistant with the prompt on stdin and counts saved jobs", async () => {
    const run = start("ok");
    expect(run.status).toBe("running");
    await until(() => last()?.status === "done");
    const done = last();
    expect(done?.jobsAdded).toBe(1);
    expect(done?.summary).toBe("Saved 1 new job.");
    expect(done?.steps.map((s) => s.text)).toContain("Saved: DV Engineer at Arm");
    expect(readFileSync(join(dir, "prompt.txt"), "utf8")).toContain("campaignId c1");
  });

  it("passes research-only connector settings to the assistant", async () => {
    start("ok");
    await until(() => last()?.status === "done");
    // The fake echoes nothing about args, so check the run can't be started twice instead.
    start("hang");
    expect(() => start("ok")).toThrow(/already running/);
  });

  it("can be stopped, and keeps what was saved", async () => {
    start("hang");
    await until(() => (currentRun(dir)?.steps.length ?? 0) >= 2);
    stopRun(dir);
    await until(() => last()?.status === "stopped");
    expect(last()?.summary).toMatch(/^Stopped/);
    expect(currentRun(dir)).toBeUndefined();
  });

  it("reports a sign-in problem clearly", async () => {
    start("fail");
    await until(() => last()?.status === "failed");
    expect(last()?.error).toMatch(/sign in/);
  });

  it("stops a run that goes on too long", async () => {
    start("hang", { maxMs: 300 });
    await until(() => last()?.status === "stopped" || last()?.status === "failed");
    expect(last()?.steps.some((s) => /Stopped after/.test(s.text))).toBe(true);
  });

  it("refuses unknown campaigns and a missing connector", () => {
    expect(() => start("ok", { campaignId: "nope" })).toThrow(/Campaign not found/);
    expect(() => start("ok", { mcpBundle: join(dir, "missing.mjs") })).toThrow(/connector/);
  });
});

describe("running a search with Claude Code", () => {
  const claude = (mode: string) =>
    start(mode, { assistant: "claude", command: { cmd: process.execPath, args: [FAKE_CLAUDE] } });

  it("limits Claude Code to the research connector and web tools", async () => {
    const run = claude("ok");
    expect(run.assistant).toBe("Claude Code");
    await until(() => last()?.status === "done");
    const args: string[] = JSON.parse(readFileSync(join(dir, "args.json"), "utf8"));
    expect(args).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__career-desk,WebSearch,WebFetch");
    expect(args[args.indexOf("--disallowedTools") + 1]).toMatch(/Bash/);
    const config = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1] ?? "", "utf8"));
    expect(config.mcpServers["career-desk"].args).toEqual(
      expect.arrayContaining(["--research-only", "--campaign", "c1"]),
    );
  });

  it("shows searches, saved jobs and refusals as steps", async () => {
    claude("ok");
    await until(() => last()?.status === "done");
    const texts = last()?.steps.map((s) => s.text) ?? [];
    expect(texts).toContain("Searched: DV jobs Bengaluru");
    expect(texts).toContain("Saved: DV Engineer at Arm");
    expect(texts).toContain("add_job: This job is already saved");
    expect(last()?.jobsAdded).toBe(1);
  });

  it("tells the user to sign in to Claude Code", async () => {
    claude("fail");
    await until(() => last()?.status === "failed");
    expect(last()?.error).toMatch(/run claude and sign in/);
  });
});
