import { existsSync, mkdirSync, watch } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Workspace } from "../src/lib/workspace";
import { autostartStatus, setAutostart } from "./autostart";
import { findContacts } from "./discovery/contacts";
import { runBoardQueries, runPythonTool } from "./discovery/python";
import { readState, writeAtomic, writeIfRevision } from "./folderFile";
import { availableAssistants, currentRun, recentRuns, startRun, stopRun } from "./runner";
import { connectorStatus, testConnection } from "./status";

/**
 * HTTP routes for the linked workspace folder, shared by the Vite dev/preview
 * plugin and the standalone launcher server. Plain Node only (no Vite import),
 * so the launcher bundle stays small.
 */
export const API = "/__career-desk";
const MAX_BODY = 100 * 1024 * 1024;

export type Validate = (value: unknown) => unknown;

export interface FolderApiOptions {
  dir: string;
  /** Returns a loader for the app's validateWorkspace, or undefined if not ready. */
  getValidate: () => (() => Promise<Validate>) | undefined;
  /** The built MCP connector, for status and the connection test. */
  mcpBundle: string;
  /** Node used to run the connector (defaults to this process's Node). */
  nodePath?: string;
  serverKind: "dev" | "preview" | "launcher";
  /** Career Desk.cmd, for "start with Windows" (launcher only). */
  launcherCmd?: string;
}

export function createFolderApi(opts: FolderApiOptions) {
  const { dir } = opts;
  let boardSearchRunning = false;
  const current = () => {
    const state = readState(dir);
    return "exists" in state && state.exists ? { exists: true, revision: state.revision } : state;
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host)
      return send(res, 403, { error: "Cross-origin request refused" });

    if (path === `${API}/workspace` && req.method === "GET") {
      const state = readState(dir);
      if ("error" in state) return send(res, 422, { folder: dir, error: state.error });
      return send(res, 200, { folder: dir, workspace: state.exists ? state.value : null });
    }

    if (path === `${API}/workspace` && req.method === "PUT") {
      let body: {
        expectedRevision: number | null;
        workspace: { revision: number };
        guide?: string;
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      const expected = body?.expectedRevision;
      if (!(expected === null || (Number.isInteger(expected) && expected >= 0)))
        return send(res, 400, { error: "expectedRevision must be a whole number or null" });
      if (body.guide !== undefined && typeof body.guide !== "string")
        return send(res, 400, { error: "guide must be text" });
      const loadValidate = opts.getValidate();
      if (!loadValidate) return send(res, 503, { error: "Workspace validation is not ready" });
      let workspace: { revision: number };
      try {
        workspace = (await loadValidate())(body.workspace) as { revision: number };
      } catch (e) {
        // Schema errors list each problem; keep the first few, readable.
        const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
        const message = Array.isArray(issues)
          ? issues
              .slice(0, 5)
              .map((i) => `${i.path.map(String).join(".") || "workspace"}: ${i.message}`)
              .join("; ")
          : e instanceof Error
            ? e.message
            : String(e);
        return send(res, 422, { error: `The workspace was not saved: ${message.slice(0, 600)}` });
      }
      const result = writeIfRevision(dir, expected, workspace);
      if ("error" in result) return send(res, 409, { error: result.error });
      if ("conflict" in result)
        return send(res, 409, { error: "conflict", revision: result.revision });
      if (body.guide && !existsSync(join(dir, "ASSISTANT.md")))
        writeAtomic(dir, "ASSISTANT.md", body.guide);
      return send(res, 200, { revision: workspace.revision });
    }

    if (path === `${API}/events` && req.method === "GET") {
      mkdirSync(dir, { recursive: true });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Send the current state at once, so a reconnecting page catches up on
      // anything it missed while disconnected.
      res.write(`data: ${JSON.stringify(current())}\n\n`);
      let timer: NodeJS.Timeout | undefined;
      const watcher = watch(dir, (_kind, name) => {
        if (name !== "workspace.json") return;
        clearTimeout(timer);
        // Debounce: editors and assistants often write in several steps.
        timer = setTimeout(() => res.write(`data: ${JSON.stringify(current())}\n\n`), 200);
      });
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearTimeout(timer);
        clearInterval(ping);
        watcher.close();
      });
      return;
    }

    if (path === `${API}/status` && req.method === "GET")
      return send(res, 200, {
        ...connectorStatus(dir, opts.mcpBundle, opts.nodePath),
        server: opts.serverKind,
      });

    if (path === `${API}/runs` && req.method === "GET")
      return send(res, 200, {
        assistants: availableAssistants().map(({ id, name }) => ({ id, name })),
        current: currentRun(dir) ?? null,
        recent: recentRuns(dir),
      });

    if (path === `${API}/runs` && req.method === "POST") {
      let body: { campaignId?: unknown; count?: unknown; assistant?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      if (typeof body?.campaignId !== "string")
        return send(res, 400, { error: "campaignId is required" });
      if (body.assistant !== undefined && body.assistant !== "codex" && body.assistant !== "claude")
        return send(res, 400, { error: "assistant must be codex or claude" });
      try {
        const run = startRun({
          assistant: body.assistant,
          dir,
          campaignId: body.campaignId,
          count: Number(body.count ?? 5),
          mcpBundle: opts.mcpBundle,
          nodePath: opts.nodePath,
        });
        return send(res, 200, { run });
      } catch (e) {
        return send(res, 409, { error: (e as Error).message });
      }
    }

    if (path === `${API}/runs/stop` && req.method === "POST") {
      try {
        stopRun(dir);
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 409, { error: (e as Error).message });
      }
    }

    // Job-board search through JobSpy. Returns raw postings; the app maps and
    // ranks them (src/lib/boards.ts) and saves only the ones the user picks.
    if (path === `${API}/boards` && req.method === "POST") {
      if (boardSearchRunning)
        return send(res, 409, { error: "A job-board search is already running" });
      let body: { queries?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      const queries = body?.queries;
      if (
        !Array.isArray(queries) ||
        !queries.length ||
        queries.some((q) => !q || typeof q !== "object")
      )
        return send(res, 400, { error: "queries must be a list of searches" });
      boardSearchRunning = true;
      try {
        return send(res, 200, await runBoardQueries(queries));
      } catch (e) {
        return send(res, 502, { error: (e as Error).message });
      } finally {
        boardSearchRunning = false;
      }
    }

    // CV PDF through RenderCV. The app builds the RenderCV document
    // (src/lib/cv/rendercv.ts); this only runs the renderer.
    if (path === `${API}/cv/render` && req.method === "POST") {
      let body: { doc?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      if (!body?.doc || typeof body.doc !== "object")
        return send(res, 400, { error: "doc is required" });
      try {
        return send(res, 200, await runPythonTool("render_cv.py", { doc: body.doc }, 200_000));
      } catch (e) {
        return send(res, 502, { error: (e as Error).message });
      }
    }

    // Published recruiter emails for one saved job (server/discovery/contacts.ts).
    // Returns findings only; the app saves the ones the user picks.
    if (path === `${API}/contacts/find` && req.method === "POST") {
      let body: { jobId?: unknown; website?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      if (typeof body?.jobId !== "string") return send(res, 400, { error: "jobId is required" });
      if (body.website !== undefined && typeof body.website !== "string")
        return send(res, 400, { error: "website must be a link" });
      const state = readState(dir);
      if (!("exists" in state) || !state.exists)
        return send(res, 409, { error: "Open your workspace first" });
      const w = state.value as Workspace;
      const job = w.jobs.find((j) => j.id === body.jobId);
      if (!job) return send(res, 404, { error: "Job not found. Save it first." });
      try {
        return send(
          res,
          200,
          await findContacts(w, job, { website: (body.website as string) || undefined }),
        );
      } catch (e) {
        return send(res, 502, { error: (e as Error).message });
      }
    }

    if (path === `${API}/autostart` && req.method === "GET")
      return send(res, 200, { ...autostartStatus(), available: !!opts.launcherCmd });

    if (path === `${API}/autostart` && req.method === "POST") {
      if (!opts.launcherCmd)
        return send(res, 409, { error: "Start Career Desk with Career Desk.cmd to use this" });
      let body: { enabled?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      if (typeof body?.enabled !== "boolean")
        return send(res, 400, { error: "enabled must be true or false" });
      try {
        return send(res, 200, setAutostart(body.enabled, opts.launcherCmd));
      } catch (e) {
        return send(res, 500, { error: (e as Error).message });
      }
    }

    if (path === `${API}/connection-test` && req.method === "POST")
      return send(res, 200, await testConnection(dir, opts.mcpBundle, opts.nodePath));

    send(res, 404, { error: "Not found" });
  }

  /** Handles /__career-desk/* requests; returns false for anything else. */
  return function route(req: IncomingMessage, res: ServerResponse): boolean {
    if (!req.url?.startsWith(`${API}/`)) return false;
    handle(req, res).catch((e) => send(res, 500, { error: String(e) }));
    return true;
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error("Workspace is too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}
