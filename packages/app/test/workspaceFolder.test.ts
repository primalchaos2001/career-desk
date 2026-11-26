import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API, workspaceFolder } from "../server/workspaceFolder";
import { blankWorkspace, validateWorkspace, type Workspace } from "../src/lib/workspace";

let dir: string;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "career-desk-"));
  const plugin = workspaceFolder(dir, { validate: validateWorkspace });
  const handlers: ((req: unknown, res: unknown, next: () => void) => void)[] = [];
  plugin.configurePreviewServer({
    middlewares: { use: (h: never) => handlers.push(h) },
    config: { root: "." },
  } as never);
  server = createServer((req, res) =>
    handlers[0]?.(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${API}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
});

const file = () => join(dir, "workspace.json");
const disk = (): Workspace => JSON.parse(readFileSync(file(), "utf8"));
const put = (expectedRevision: number | null, workspace: unknown, guide?: string) =>
  fetch(`${base}/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, workspace, guide }),
  });
const at = (w: Workspace, revision: number) => ({ ...w, revision });

describe("linked workspace folder", () => {
  it("reports an empty folder, then seeds workspace.json and the assistant guide", async () => {
    const empty = await (await fetch(`${base}/workspace`)).json();
    expect(empty).toEqual({ folder: dir, workspace: null });
    expect((await put(null, blankWorkspace(), "# guide")).status).toBe(200);
    expect(disk().revision).toBe(0);
    expect(readFileSync(join(dir, "ASSISTANT.md"), "utf8")).toBe("# guide");
  });

  it("refuses incomplete or invalid workspaces and keeps the good file", async () => {
    const w = blankWorkspace();
    await put(null, w);
    const before = readFileSync(file(), "utf8");
    for (const bad of [{ revision: 1 }, { ...at(w, 1), campaigns: [{ id: "x" }] }, null]) {
      const res = await put(0, bad);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/not saved/);
    }
    expect((await put(-1, at(w, 1))).status).toBe(400);
    expect(readFileSync(file(), "utf8")).toBe(before);
  });

  it("requires the revision to go up by exactly one", async () => {
    const w = blankWorkspace();
    await put(null, w);
    const res = await put(0, at(w, 5));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/must be 1/);
    expect((await put(0, at(w, 1))).status).toBe(200);
  });

  it("refuses a save based on a stale revision (assistant edited the file)", async () => {
    const w = blankWorkspace();
    await put(null, w);
    writeFileSync(file(), JSON.stringify({ ...at(w, 1), profile: { ...w.profile, name: "A" } }));
    const res = await put(0, at(w, 1));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", revision: 1 });
    expect(disk().profile.name).toBe("A");
  });

  it("keeps a backup of each replaced version", async () => {
    const w = blankWorkspace();
    await put(null, w);
    await put(0, at(w, 1));
    await put(1, at(w, 2));
    expect(readdirSync(join(dir, ".backup")).sort()).toEqual([
      "workspace-r0.json",
      "workspace-r1.json",
    ]);
  });

  it("never overwrites a broken file and reports it on read", async () => {
    writeFileSync(file(), "{ half written");
    expect((await fetch(`${base}/workspace`)).status).toBe(422);
    expect((await put(null, blankWorkspace())).status).toBe(409);
    expect(readFileSync(file(), "utf8")).toBe("{ half written");
    expect(existsSync(join(dir, "ASSISTANT.md"))).toBe(false);
  });

  it("sends the current revision as soon as a page (re)connects", async () => {
    await put(null, at(blankWorkspace(), 7));
    const controller = new AbortController();
    const res = await fetch(`${base}/events`, { signal: controller.signal });
    const reader = res.body?.getReader();
    let text = "";
    while (!text.includes("data:")) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    expect(text).toContain('"revision":7');
  });

  it("rejects requests from other websites", async () => {
    const res = await fetch(`${base}/workspace`, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});
