import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readState } from "./folderFile";

/**
 * What the Connections panel shows: storage, connector build and which assistant
 * apps have Career Desk set up. Only reads files; never edits assistant config.
 */

export type HostStatus = {
  id: "codex" | "claude-code" | "claude-desktop" | "gemini";
  name: string;
  configFile: string;
  /** No config file at all: the app is probably not installed or never set up. */
  found: boolean;
  registered: boolean;
  /** Registered, and pointing at this connector and this workspace folder. */
  ready: boolean;
  problem?: string;
  setup: string;
};

type Entry = { command?: string; args?: string[] };

export function connectorStatus(dir: string, mcpBundle: string, nodePath = process.execPath) {
  const state = readState(dir);
  return {
    folder: dir,
    workspace:
      "error" in state
        ? { ok: false, error: state.error }
        : state.exists
          ? { ok: true, revision: state.revision }
          : { ok: false, error: "No workspace yet" },
    connector: { path: mcpBundle, built: existsSync(mcpBundle) },
    node: nodePath,
    hosts: hostStatuses(dir, mcpBundle, nodePath),
  };
}

export function hostStatuses(dir: string, mcpBundle: string, nodePath: string): HostStatus[] {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const cli = `${q(nodePath)} ${q(mcpBundle)} --dir ${q(dir)}`;
  const json = JSON.stringify(
    { mcpServers: { "career-desk": { command: nodePath, args: [mcpBundle, "--dir", dir] } } },
    null,
    2,
  );
  const hosts: [HostStatus["id"], string, string, () => Entry | undefined, string][] = [
    [
      "codex",
      "Codex (ChatGPT sign-in)",
      join(home, ".codex", "config.toml"),
      () => codexEntry(join(home, ".codex", "config.toml")),
      `codex mcp add career-desk -- ${cli}`,
    ],
    [
      "claude-code",
      "Claude Code",
      join(home, ".claude.json"),
      () => jsonEntry(join(home, ".claude.json")),
      `claude mcp add --scope user career-desk -- ${cli}`,
    ],
    [
      "claude-desktop",
      "Claude desktop app",
      join(appData, "Claude", "claude_desktop_config.json"),
      () => jsonEntry(join(appData, "Claude", "claude_desktop_config.json")),
      `Settings → Developer → Edit config, then add:\n${json}`,
    ],
    [
      "gemini",
      "Gemini CLI (Google sign-in)",
      join(home, ".gemini", "settings.json"),
      () => jsonEntry(join(home, ".gemini", "settings.json")),
      `Add to ~/.gemini/settings.json:\n${json}`,
    ],
  ];
  return hosts.map(([id, name, configFile, read, setup]) => {
    const found = existsSync(configFile);
    let entry: Entry | undefined;
    let problem: string | undefined;
    try {
      entry = found ? read() : undefined;
    } catch (e) {
      problem = `Couldn't read ${configFile}: ${(e as Error).message}`;
    }
    if (entry && !problem) problem = checkEntry(entry, dir, mcpBundle);
    return {
      id,
      name,
      configFile,
      found,
      registered: !!entry,
      ready: !!entry && !problem,
      problem,
      setup,
    };
  });
}

function checkEntry(entry: Entry, dir: string, mcpBundle: string): string | undefined {
  const args = entry.args ?? [];
  const bundle = args.find((a) => /career-desk-mcp\.mjs$/i.test(a));
  if (!bundle) return "Set up, but not with this connector file";
  if (!samePath(bundle, mcpBundle)) return `Uses a different connector: ${bundle}`;
  if (!existsSync(bundle)) return "The connector file it points to no longer exists";
  const at = args.indexOf("--dir");
  const folder =
    at >= 0 ? args[at + 1] : process.env.CAREER_DESK_DIR || join(homedir(), "CareerDesk");
  if (!folder || !samePath(folder, dir)) return `Uses a different workspace folder: ${folder}`;
  if (entry.command && /[\\/]/.test(entry.command) && !existsSync(entry.command))
    return `Its Node program is missing: ${entry.command}`;
  return undefined;
}

const samePath = (a: string, b: string) =>
  resolve(a)
    .replace(/[\\/]+$/, "")
    .toLowerCase() ===
  resolve(b)
    .replace(/[\\/]+$/, "")
    .toLowerCase();

function jsonEntry(file: string): Entry | undefined {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const found = data?.mcpServers?.["career-desk"];
  if (found) return found;
  // Claude Code also keeps per-project servers.
  for (const project of Object.values(data?.projects ?? {}) as {
    mcpServers?: Record<string, Entry>;
  }[])
    if (project?.mcpServers?.["career-desk"]) return project.mcpServers["career-desk"];
  return undefined;
}

/** Reads the [mcp_servers.career-desk] table from Codex's TOML config. */
function codexEntry(file: string): Entry | undefined {
  const text = readFileSync(file, "utf8");
  const start = text.search(/^\[mcp_servers\.(?:"career-desk"|career-desk)\]\s*$/m);
  if (start < 0) return undefined;
  const rest = text.slice(start).split("\n").slice(1);
  const end = rest.findIndex((l) => /^\s*\[/.test(l));
  const table = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  // TOML: 'literal' strings have no escapes; "basic" strings use backslash escapes.
  const ESC: Record<string, string> = {
    b: "\b",
    t: "\t",
    n: "\n",
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
  const str = (s: string) =>
    s.startsWith("'")
      ? s.slice(1, -1)
      : s
          .slice(1, -1)
          .replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e: string) =>
            e.length > 1 ? String.fromCodePoint(Number.parseInt(e.slice(1), 16)) : (ESC[e] ?? e),
          );
  const command = table.match(/^\s*command\s*=\s*('[^']*'|"(?:[^"\\]|\\.)*")/m)?.[1];
  const argsRaw = table.match(/^\s*args\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
  const args = [...argsRaw.matchAll(/'[^']*'|"(?:[^"\\]|\\.)*"/g)].map((m) => str(m[0]));
  return { command: command ? str(command) : undefined, args };
}

/**
 * Start the real connector the way an assistant would and read the workspace
 * through it (read-only). Passes only if it sees the revision the app sees.
 */
export function testConnection(
  dir: string,
  mcpBundle: string,
  nodePath = process.execPath,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; message: string; tools?: number; revision?: number; ms: number }> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  return new Promise((done) => {
    if (!existsSync(mcpBundle))
      return done({ ok: false, message: "The connector hasn't been built yet", ms: ms() });
    const child = spawn(nodePath, [mcpBundle, "--dir", dir], { stdio: ["pipe", "pipe", "ignore"] });
    const finish = (r: { ok: boolean; message: string; tools?: number; revision?: number }) => {
      clearTimeout(timer);
      child.kill();
      done({ ...r, ms: ms() });
    };
    const timer = setTimeout(
      () => finish({ ok: false, message: "The connector didn't answer in time" }),
      timeoutMs,
    );
    child.on("error", (e) => finish({ ok: false, message: `Couldn't start it: ${e.message}` }));
    let buf = "";
    let tools = 0;
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      for (let k = buf.indexOf("\n"); k >= 0; k = buf.indexOf("\n")) {
        const line = buf.slice(0, k);
        buf = buf.slice(k + 1);
        let m: {
          id?: number;
          result?: { tools?: unknown[]; content?: { text: string }[]; isError?: boolean };
        };
        try {
          m = JSON.parse(line);
        } catch {
          return finish({ ok: false, message: "The connector sent something unexpected" });
        }
        if (m.id === 2) tools = m.result?.tools?.length ?? 0;
        if (m.id === 3) {
          const text = m.result?.content?.[0]?.text ?? "";
          if (m.result?.isError) return finish({ ok: false, message: text, tools });
          const seen = JSON.parse(text).revision as number;
          const state = readState(dir);
          const expected = "exists" in state && state.exists ? state.revision : undefined;
          return finish(
            seen === expected
              ? {
                  ok: true,
                  message: `Connected: ${tools} tools, same workspace (revision ${seen})`,
                  tools,
                  revision: seen,
                }
              : {
                  ok: false,
                  message: `The connector sees revision ${seen}, the app ${expected}`,
                  tools,
                },
          );
        }
      }
    });
    const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "career-desk-connection-test", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_overview", arguments: {} },
    });
  });
}
