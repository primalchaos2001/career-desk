import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Optional "start Career Desk when I sign in to Windows", so morning searches
 * run without the user remembering to open it. Only ever changed by the user's
 * click in the app; it writes or removes one small file in their own Startup
 * folder, which they can also delete by hand.
 */

const FILE = "Career Desk (morning search).cmd";

export function startupFolder(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

export function autostartStatus() {
  const folder = startupFolder();
  return { supported: !!folder, enabled: !!folder && existsSync(join(folder, FILE)) };
}

export function setAutostart(enabled: boolean, launcherCmd: string) {
  const folder = startupFolder();
  if (!folder) throw new Error("Starting with Windows is only available on Windows");
  const file = join(folder, FILE);
  if (!enabled) {
    rmSync(file, { force: true });
    return autostartStatus();
  }
  if (!existsSync(launcherCmd)) throw new Error(`Launcher not found: ${launcherCmd}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    file,
    [
      "@echo off",
      "rem Added by Career Desk so morning job searches run. Delete this file to stop it.",
      `start "Career Desk" /min cmd /c ""${launcherCmd}" --no-open"`,
      "",
    ].join("\r\n"),
  );
  return autostartStatus();
}
