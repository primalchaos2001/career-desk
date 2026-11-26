import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blankWorkspace, WorkspaceSchema } from "../src/lib/workspace";
import { parseCsv, readWorkspaceFile, workspaceZip } from "../src/lib/workspaceTransfer";

describe("portable workspace", () => {
  it("round trips a validated ZIP with personal document snapshots", () => {
    const w = blankWorkspace();
    w.profile.name = "Asha";
    w.profile.resumeFile = {
      name: "../../CV.txt",
      mime: "text/plain",
      base64: btoa("Verified CV facts"),
    };
    const zip = workspaceZip(w, z.toJSONSchema(WorkspaceSchema));
    expect(readWorkspaceFile(zip, "career.zip")).toEqual(w);
    expect(readWorkspaceFile(zip, "download-without-extension")).toEqual(w);
    const files = unzipSync(zip);
    expect(Object.keys(files).some((name) => name.includes("../"))).toBe(false);
    expect(Object.keys(files).some((name) => name.startsWith("documents/current/"))).toBe(true);
  });
  it("rejects malformed files and parses quoted job descriptions", () => {
    expect(() =>
      readWorkspaceFile(new TextEncoder().encode('{"schemaVersion":22}'), "x.json"),
    ).toThrow();
    expect(
      parseCsv(
        'title,company,url,description\r\nConsultant,Firm,https://example.com,"Research, strategy\nand delivery"',
      )[0]?.description,
    ).toBe("Research, strategy\nand delivery");
    expect(() => parseCsv('title,company,url\nx,x,"unclosed')).toThrow(/quote/);
  });
});
