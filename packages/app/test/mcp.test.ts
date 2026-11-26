import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../server/mcp/main";
import { callTool, listTools } from "../server/mcp/tools";
import { blankWorkspace, validateWorkspace, type Workspace } from "../src/lib/workspace";

let dir: string;
const ctx = () => ({ dir, client: "Test Assistant" });
const disk = (): Workspace => JSON.parse(readFileSync(join(dir, "workspace.json"), "utf8"));
const campaign = (id: string, mode: "research" | "draft") => ({
  id,
  name: `VLSI ${id}`,
  track: "other" as const,
  titles: "Verification Engineer",
  locations: "Bengaluru",
  keywords: "UVM",
  exclusions: "",
  minLpa: "",
  maxLpa: "",
  mode,
  templateId: "cover",
  notes: "",
  createdAt: new Date().toISOString(),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "career-desk-mcp-"));
  const w = blankWorkspace();
  for (const t of w.templates) t.reviewedAt = new Date().toISOString();
  w.profile.name = "Test User";
  w.profile.email = "test@example.com";
  w.campaigns.push(campaign("research", "research"), campaign("draft", "draft"));
  writeFileSync(join(dir, "workspace.json"), JSON.stringify(validateWorkspace(w)));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const job = (campaignId: string, url = "https://careers.example.com/jobs/1?utm_source=x") => ({
  campaignId,
  url,
  company: "Example Semi",
  title: "Design Verification Engineer",
  location: "Bengaluru",
  verified: true,
});

describe("Career Desk MCP tools", () => {
  it("lists tools with JSON object input schemas and no tool that sends, submits, approves or deletes", () => {
    const tools = listTools();
    expect(tools.map((t) => t.name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(send|submit|delete|approve)/)]),
    );
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
  });

  it("adds a job, bumps the revision once and tags the activity log with the assistant", () => {
    const before = disk().revision;
    const saved = callTool(ctx(), "add_job", job("research")) as { id: string; verifiedAt: string };
    const after = disk();
    expect(after.revision).toBe(before + 1);
    expect(after.jobs[0]?.id).toBe(saved.id);
    expect(saved.verifiedAt).not.toBe("");
    expect(after.events[0]?.message).toMatch(/via Test Assistant$/);
    expect(() => validateWorkspace(after)).not.toThrow();
  });

  it("refuses a duplicate job URL across campaigns", () => {
    callTool(ctx(), "add_job", job("research"));
    expect(() =>
      callTool(ctx(), "add_job", job("draft", "https://careers.example.com/jobs/1")),
    ).toThrow(/already saved/);
  });

  it("enforces the campaign permission mode for preparing applications", () => {
    const r = callTool(ctx(), "add_job", job("research")) as { id: string };
    expect(() => callTool(ctx(), "prepare_application", { jobId: r.id })).toThrow(/research only/);
    const d = callTool(ctx(), "add_job", job("draft", "https://careers.example.com/jobs/2")) as {
      id: string;
    };
    const app = callTool(ctx(), "prepare_application", { jobId: d.id }) as {
      status: string;
      coverLetter: string;
    };
    expect(app.status).toBe("prepared");
    expect(app.coverLetter).toContain("Example Semi");
  });

  it("will not record an application as applied without a confirmation reference", () => {
    const d = callTool(ctx(), "add_job", job("draft")) as { id: string };
    const app = callTool(ctx(), "prepare_application", { jobId: d.id }) as { id: string };
    expect(() =>
      callTool(ctx(), "update_application", { applicationId: app.id, status: "applied" }),
    ).toThrow(/confirmation/);
    expect(disk().applications[0]?.status).toBe("prepared");
  });

  it("saves and then updates a work session", () => {
    const s = callTool(ctx(), "save_session", {
      campaignId: "research",
      title: "Find DV roles",
      notes: "Checked 3 listings",
      nextAction: "Review Arm role",
    }) as { id: string };
    callTool(ctx(), "save_session", {
      sessionId: s.id,
      campaignId: "research",
      title: "Find DV roles",
      notes: "Done",
      nextAction: "Apply",
      status: "completed",
    });
    expect(disk().sessions).toHaveLength(1);
    expect(disk().sessions[0]).toMatchObject({ status: "completed", nextAction: "Apply" });
  });

  it("rejects bad arguments and leaves a broken workspace file untouched", () => {
    expect(() => callTool(ctx(), "add_job", { campaignId: "research" })).toThrow(
      /Invalid arguments/,
    );
    writeFileSync(join(dir, "workspace.json"), "{ broken");
    expect(() => callTool(ctx(), "add_job", job("research"))).toThrow(/not valid JSON/);
    expect(readFileSync(join(dir, "workspace.json"), "utf8")).toBe("{ broken");
  });
});

describe("Career Desk MCP protocol", () => {
  it("negotiates the protocol, ignores notifications and reports tool errors to the model", () => {
    const handle = createServer(dir);
    const init = handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "codex-cli" } },
    }) as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(handle({ jsonrpc: "2.0", id: 2, method: "nope" })).toMatchObject({
      error: { code: -32601 },
    });
    const bad = handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_job", arguments: { jobId: "missing" } },
    }) as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
    handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "save_session",
        arguments: { campaignId: "draft", title: "t", notes: "", nextAction: "" },
      },
    });
    expect(disk().sessions[0]?.host).toBe("codex");
  });
});
