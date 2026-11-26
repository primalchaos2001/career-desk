import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autostartStatus, setAutostart, startupFolder } from "../server/autostart";

const saved = process.env.APPDATA;
afterEach(() => {
  process.env.APPDATA = saved;
});

describe.runIf(process.platform === "win32")("start with Windows", () => {
  it("adds and removes one file in the user's Startup folder", () => {
    process.env.APPDATA = mkdtempSync(join(tmpdir(), "cd-appdata-"));
    const launcher = join(mkdtempSync(join(tmpdir(), "cd-app-")), "Career Desk.cmd");
    writeFileSync(launcher, "@echo off\r\n");
    expect(autostartStatus().enabled).toBe(false);
    expect(setAutostart(true, launcher).enabled).toBe(true);
    const file = join(startupFolder() as string, "Career Desk (morning search).cmd");
    expect(readFileSync(file, "utf8")).toContain(`"${launcher}" --no-open`);
    expect(setAutostart(false, launcher).enabled).toBe(false);
  });
});
