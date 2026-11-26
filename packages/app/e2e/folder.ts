import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The workspace folder the e2e dev/preview server uses (CAREER_DESK_DIR), so
 * browser tests never touch the real ~/CareerDesk. The server has one folder
 * for every test, so tests run one at a time and start from an empty folder.
 */
export const E2E_DIR = join(tmpdir(), "career-desk-e2e");

/** Empties the folder (keeping it, since the server watches it). */
export function resetWorkspaceFolder() {
  mkdirSync(E2E_DIR, { recursive: true });
  for (const name of readdirSync(E2E_DIR))
    rmSync(join(E2E_DIR, name), { recursive: true, force: true });
}
