import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeIfRevision } from "../server/folderFile";
import { blankWorkspace } from "../src/lib/workspace";
import { nextVersion } from "../src/lib/workspaceStore";

describe("saving an imported workspace to the folder", () => {
  it("accepts an import whose revision is ahead of the file on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "cd-store-"));
    const onDisk = { ...blankWorkspace(), revision: 3 };
    writeFileSync(join(dir, "workspace.json"), JSON.stringify(onDisk));
    const imported = { ...blankWorkspace(), revision: 4 };
    const saved = nextVersion(imported, onDisk.revision);
    expect(saved.revision).toBe(4);
    expect(writeIfRevision(dir, onDisk.revision, saved)).toEqual({ ok: true });
  });

  it("still refuses a save based on an older revision", () => {
    const dir = mkdtempSync(join(tmpdir(), "cd-store-"));
    writeFileSync(
      join(dir, "workspace.json"),
      JSON.stringify({ ...blankWorkspace(), revision: 5 }),
    );
    const saved = nextVersion({ ...blankWorkspace(), revision: 9 }, 3);
    expect(writeIfRevision(dir, 3, saved)).toEqual({ conflict: true, revision: 5 });
  });
});
