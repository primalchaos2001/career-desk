import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostStatuses, testConnection } from "../server/status";
import { blankWorkspace, validateWorkspace } from "../src/lib/workspace";

const BUNDLE = resolve(__dirname, "../dist-mcp/career-desk-mcp.mjs");

let home: string;
let dir: string;
const saved = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  APPDATA: process.env.APPDATA,
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "career-desk-home-"));
  dir = join(home, "CareerDesk");
  mkdirSync(dir);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = join(home, "AppData", "Roaming");
});
afterEach(() => {
  Object.assign(process.env, saved);
  rmSync(home, { recursive: true, force: true });
});

const status = (id: string) => {
  const s = hostStatuses(dir, BUNDLE, process.execPath).find((h) => h.id === id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};

describe("assistant setup detection (read-only)", () => {
  it("reports apps that aren't installed or don't have Career Desk yet", () => {
    expect(status("codex")).toMatchObject({ found: false, registered: false, ready: false });
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "config.toml"),
      'model = "x"\n[mcp_servers.other]\ncommand = "a"\n',
    );
    expect(status("codex")).toMatchObject({ found: true, registered: false });
    expect(status("codex").setup).toMatch(/^codex mcp add career-desk -- /);
  });

  it.skipIf(!existsSync(BUNDLE))("reads Codex's TOML entry, including Windows paths", () => {
    mkdirSync(join(home, ".codex"));
    const toml = (s: string) => `"${s.replace(/\\/g, "\\\\")}"`;
    writeFileSync(
      join(home, ".codex", "config.toml"),
      [
        "[mcp_servers.career-desk]",
        `command = ${toml(process.execPath)}`,
        `args = [${toml(BUNDLE)}, "--dir", '${dir}']`,
        "",
        "[projects.x]",
        'trust_level = "trusted"',
      ].join("\n"),
    );
    expect(status("codex")).toMatchObject({ registered: true, ready: true });
  });

  it.skipIf(!existsSync(BUNDLE))("explains a JSON entry pointing at another folder", () => {
    mkdirSync(join(home, ".gemini"));
    writeFileSync(
      join(home, ".gemini", "settings.json"),
      JSON.stringify({
        mcpServers: {
          "career-desk": { command: "node", args: [BUNDLE, "--dir", join(home, "Other")] },
        },
      }),
    );
    const g = status("gemini");
    expect(g).toMatchObject({ registered: true, ready: false });
    expect(g.problem).toMatch(/different workspace folder/);
  });

  it("finds Claude Code's per-project entries", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        projects: { p: { mcpServers: { "career-desk": { command: "node", args: ["x.js"] } } } },
      }),
    );
    expect(status("claude-code")).toMatchObject({ registered: true, ready: false });
  });
});

describe.skipIf(!existsSync(BUNDLE))("connection test", () => {
  it("passes when the connector sees the same workspace revision", async () => {
    writeFileSync(
      join(dir, "workspace.json"),
      JSON.stringify(validateWorkspace({ ...blankWorkspace(), revision: 4 })),
    );
    const r = await testConnection(dir, BUNDLE, process.execPath);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/same workspace \(revision 4\)/);
  });

  it("fails clearly when there is no workspace", async () => {
    const r = await testConnection(dir, BUNDLE, process.execPath);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No workspace/);
  });

  it("fails clearly when the connector file is missing", async () => {
    const r = await testConnection(dir, join(home, "missing.mjs"), process.execPath);
    expect(r).toMatchObject({ ok: false, message: "The connector hasn't been built yet" });
  });
});
