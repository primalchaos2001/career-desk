import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Shared access to the linked workspace folder. Used by the app's local server
 * and by the MCP server, so both follow the same rules: atomic writes, a short
 * lock between processes, and compare-and-swap on the workspace revision.
 */
export function defaultFolder() {
  return resolve(process.env.CAREER_DESK_DIR || join(homedir(), "CareerDesk"));
}

export type FileState =
  | { exists: false }
  | { exists: true; revision: number; value: unknown }
  | { error: string };

export type WriteResult =
  | { ok: true }
  | { conflict: true; revision: number | null }
  | { error: string };

export function readState(dir: string): FileState {
  const file = join(dir, "workspace.json");
  if (!existsSync(file)) return { exists: false };
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value?.revision !== "number") return { error: "workspace.json has no revision" };
    return { exists: true, revision: value.revision, value };
  } catch (e) {
    return { error: `workspace.json is not valid JSON: ${(e as Error).message}` };
  }
}

export function writeAtomic(dir: string, name: string, text: string) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, join(dir, name)); // readers never see half a file
}

/** Write workspace.json only if the revision on disk is still `expectedRevision`. */
export function writeIfRevision(
  dir: string,
  expectedRevision: number | null,
  workspace: { revision: number },
): WriteResult {
  return withLock(dir, () => {
    const state = readState(dir);
    if ("error" in state) return { error: `${state.error}. Fix the file before saving.` };
    const onDisk = state.exists ? state.revision : null;
    if (onDisk !== expectedRevision) return { conflict: true, revision: onDisk };
    if (expectedRevision !== null && workspace.revision !== expectedRevision + 1)
      return { error: `The new revision must be ${expectedRevision + 1}` };
    if (state.exists) backup(dir, state.revision);
    writeAtomic(dir, "workspace.json", `${JSON.stringify(workspace, null, 2)}\n`);
    return { ok: true };
  });
}

const BACKUPS_KEPT = 20;

/** Keep the last good versions in <folder>/.backup so a bad write can be undone. */
function backup(dir: string, revision: number) {
  const folder = join(dir, ".backup");
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(dir, "workspace.json"), join(folder, `workspace-r${revision}.json`));
  const rev = (f: string) => Number(f.match(/\d+/)?.[0]);
  const old = readdirSync(folder)
    .filter((f) => /^workspace-r\d+\.json$/.test(f))
    .sort((a, b) => rev(a) - rev(b))
    .slice(0, -BACKUPS_KEPT);
  for (const f of old) rmSync(join(folder, f), { force: true });
}

const LOCK_STALE_MS = 10_000;

function withLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".workspace.lock");
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        // A crashed writer can leave the lock behind; writes take milliseconds.
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error("The workspace is busy. Try again in a moment.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}
