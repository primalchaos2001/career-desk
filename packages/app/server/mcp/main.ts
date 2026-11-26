import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { defaultFolder } from "../folderFile";
import { callTool, INSTRUCTIONS, listTools, RESEARCH_TOOLS, type ToolContext } from "./tools";

const RESEARCH_NOTE = (campaignId?: string) =>
  `\nThis is a research-only job search${campaignId ? ` for campaign ${campaignId}` : ""}: find, verify and save jobs, then save_session. Applications and email are not available.`;

/**
 * Career Desk MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * Assistant apps launch it as a local process with the user's own sign-in, so
 * no API key is involved. Usage: node career-desk-mcp.mjs [--dir <folder>]
 * Nothing may be printed to stdout except protocol messages; logs go to stderr.
 */

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "0.1.0";

type Params = {
  protocolVersion?: string;
  clientInfo?: { name?: string };
  name?: string;
  arguments?: unknown;
};
type Message = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: Params };

export function createServer(dir: string, limits?: ToolContext["limits"]) {
  const ctx: ToolContext = { dir, client: "assistant", limits };

  return function handle(msg: Message): Message | null | Promise<Message> {
    const reply = (result: unknown): Message =>
      ({ jsonrpc: "2.0", id: msg.id ?? null, result }) as Message;
    const fail = (code: number, message: string): Message =>
      ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } }) as Message;
    const isRequest = msg.id !== undefined && msg.id !== null;

    switch (msg.method) {
      case "initialize": {
        const requested = msg.params?.protocolVersion ?? "";
        const name = msg.params?.clientInfo?.name;
        if (typeof name === "string" && name) ctx.client = name.slice(0, 60);
        return reply({
          protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "career-desk", version: VERSION },
          instructions: `${INSTRUCTIONS}\nWorkspace folder: ${dir}${limits ? RESEARCH_NOTE(limits.campaignId) : ""}`,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listTools(limits) });
      case "tools/call": {
        const ok = (result: unknown) =>
          reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        // Tool failures go back to the model as readable errors it can act on.
        const failed = (e: unknown) =>
          reply({
            content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
            isError: true,
          });
        try {
          const result = callTool(ctx, msg.params?.name ?? "", msg.params?.arguments);
          return result instanceof Promise ? result.then(ok, failed) : ok(result);
        } catch (e) {
          return failed(e);
        }
      }
      default:
        if (!isRequest) return null; // notifications such as notifications/initialized
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  };
}

export function main() {
  const given = process.argv[process.argv.indexOf("--dir") + 1];
  const dir = process.argv.includes("--dir") && given ? resolve(given) : defaultFolder();
  const campaign = process.argv[process.argv.indexOf("--campaign") + 1];
  const limits = process.argv.includes("--research-only")
    ? {
        tools: RESEARCH_TOOLS,
        campaignId: process.argv.includes("--campaign") ? campaign : undefined,
      }
    : undefined;
  const handle = createServer(dir, limits);
  console.error(`Career Desk MCP server ${VERSION} · workspace folder: ${dir}`);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg: Message;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      return;
    }
    Promise.resolve(handle(msg)).then((out) => {
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    });
  });
  lines.on("close", () => process.exit(0));
}
