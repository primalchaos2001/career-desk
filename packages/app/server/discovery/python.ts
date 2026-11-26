import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardError, BoardPosting } from "../../src/lib/boards";

/**
 * Runs Career Desk's Python tools (tools/python/*.py) with JSON in and out:
 * JobSpy for job boards (MIT, https://github.com/speedyapply/JobSpy) and
 * RenderCV for CV PDFs (MIT, https://github.com/rendercv/rendercv). Plain Node
 * with type-only app imports, so the launcher bundle stays small.
 */

/** Walk up from the given folders to find a file (repo root holds .venv and tools/). */
function findUp(rel: string, starts: string[]): string | undefined {
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

function here(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Python with JobSpy: CAREER_DESK_PYTHON, else the repo's .venv, else `python`. */
export function pythonPath(): string {
  if (process.env.CAREER_DESK_PYTHON) return process.env.CAREER_DESK_PYTHON;
  const venv = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
  return findUp(venv, [process.cwd(), here()]) ?? "python";
}

export function toolScript(name: string): string {
  const found = findUp(join("tools", "python", name), [process.cwd(), here()]);
  if (!found)
    throw new Error(`Career Desk tool ${name} not found; run from the career-desk folder`);
  return found;
}

/** Run a Python tool with JSON in and JSON out. */
export function runPythonTool<T>(script: string, input: unknown, timeoutMs = 240_000): Promise<T> {
  return new Promise((ok, fail) => {
    const child = spawn(pythonPath(), ["-I", toolScript(script)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(
        new Error(`Could not start Python (${e.message}). Set CAREER_DESK_PYTHON or create .venv`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("utf8");
      try {
        const parsed = JSON.parse(text) as T & { error?: string };
        if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error)
          return fail(new Error(parsed.error));
        if (code !== 0) throw new Error();
        ok(parsed);
      } catch {
        const tail = Buffer.concat(err).toString("utf8").trim().split("\n").slice(-3).join(" ");
        fail(new Error(`${script} failed (exit ${code}): ${tail.slice(0, 400) || "no output"}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** Run several JobSpy searches one after another and pool the results. */
export async function runBoardQueries(
  queries: unknown[],
  run: typeof runPythonTool = runPythonTool,
): Promise<{ jobs: BoardPosting[]; errors: BoardError[] }> {
  const jobs: BoardPosting[] = [];
  const errors: BoardError[] = [];
  for (const q of queries.slice(0, 3)) {
    const r = await run<{ jobs: BoardPosting[]; errors: BoardError[] }>("jobspy_search.py", q);
    jobs.push(...r.jobs);
    errors.push(...r.errors);
  }
  return { jobs, errors };
}
