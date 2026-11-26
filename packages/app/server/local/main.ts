import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkspace } from "../../src/lib/workspace";
import { createFolderApi } from "../folderApi";
import { defaultFolder } from "../folderFile";
import { startScheduler } from "../scheduler";

/**
 * Career Desk launcher server: serves the built app and the linked-folder API on
 * this PC only. Started by `Career Desk.cmd`; no pnpm or Vite needed.
 * Usage: node career-desk.mjs [--port 5317] [--dir <folder>] [--no-open]
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

export async function main() {
  // This file lives in packages/app/dist-local/; the app build is next to it.
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const staticDir = join(appRoot, "dist");
  const mcpBundle = join(appRoot, "dist-mcp", "career-desk-mcp.mjs");
  const port = Number(arg("--port") ?? process.env.CAREER_DESK_PORT ?? 5317);
  const given = arg("--dir");
  const dir = given ? resolve(given) : defaultFolder();
  const url = `http://127.0.0.1:${port}/workspace`;

  if (!existsSync(join(staticDir, "index.html"))) {
    console.error(
      `Career Desk's app files are missing (${staticDir}).\nBuild them once with: pnpm --filter @tailorats/app run local:build`,
    );
    process.exit(1);
  }

  // Already running? Just open it.
  if (await alreadyRunning(port)) {
    console.log(`Career Desk is already running. Opening ${url}`);
    if (!process.argv.includes("--no-open")) openBrowser(url);
    return;
  }

  const route = createFolderApi({
    dir,
    getValidate: () => async () => validateWorkspace,
    mcpBundle,
    serverKind: "launcher",
    launcherCmd: join(appRoot, "..", "..", "Career Desk.cmd"),
  });

  const server = createServer((req, res) => {
    // Only this PC, by name: blocks other sites reaching it via DNS tricks.
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (route(req, res)) return;
    serveStatic(staticDir, req, res);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(
      e.code === "EADDRINUSE"
        ? `Port ${port} is used by another program. Start with --port <number> to pick another.`
        : `Couldn't start: ${e.message}`,
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      [
        "",
        "  Career Desk is running.",
        `  Open:      ${url}`,
        `  Workspace: ${dir}`,
        "",
        "  Keep this window open while you use Career Desk. Close it to stop.",
        "",
      ].join("\n"),
    );
    if (!process.argv.includes("--no-open")) openBrowser(url);
    // Morning searches the user turned on run while this window is open.
    startScheduler({ dir, mcpBundle });
  });
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = resolve(root, `.${path}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  // App routes like /workspace are handled in the browser.
  if (!existsSync(file)) {
    if (extname(path)) {
      res.writeHead(404).end("Not found");
      return;
    }
    file = join(root, "index.html");
  }
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
}

async function alreadyRunning(port: number) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__career-desk/status`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = await res.json();
    return body?.server === "launcher";
  } catch {
    return false;
  }
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: true }).unref();
}
