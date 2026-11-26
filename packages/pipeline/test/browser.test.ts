import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPacks } from "@tailorats/rules/bundled";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

/**
 * Guards the browser-readiness of the pipeline (D-031): the whole analyze()
 * path must work off bundled JSON packs, with no `node:fs` pack loading.
 * `readFileSync` here only supplies the fixture bytes — in the app those come
 * from a File/ArrayBuffer.
 */
const context = { region: "us", role: "swe-intern", stage: "student" };
const packs = getPacks(["stage/student", "role/swe-intern", "region/us"]);

describe("pipeline runs on bundled packs (browser path)", () => {
  it("analyzes a .tex resume with no filesystem pack loading", async () => {
    const source = readFileSync(
      join(__dirname, "../../evals/golden/tex/jakes-clean-swe.tex"),
      "utf8",
    );
    const { report } = await analyze({ source: { kind: "tex", source }, context, packs });
    expect(report.degraded).toBe(true);
    expect(report.findings.map((f) => f.id)).toContain("stu-coursework");
  });

  it("analyzes a PDF in degraded mode, producing fidelity + region findings", async () => {
    const data = new Uint8Array(
      readFileSync(join(__dirname, "../../core/test/fixtures/pdf/india-fresher.pdf")),
    );
    const { report } = await analyze({ source: { kind: "pdf", data }, context, packs });
    expect(report.scores.fidelity).toBeGreaterThan(0);
    expect(report.findings.map((f) => f.id)).toContain("us-no-photo");
  });

  it("no browser-bound source file imports node builtins", () => {
    const roots = [
      "../../core/src/ingest/pdf.ts",
      "../../core/src/ingest/tex.ts",
      "../../core/src/ingest/fidelity.ts",
      "../../core/src/enrich/github.ts",
      "../../rules/src/bundled.ts",
      "../../rules/src/engine.ts",
      "../src/index.ts",
    ];
    for (const rel of roots) {
      const src = readFileSync(join(__dirname, rel), "utf8");
      expect(src, `${rel} imports a node builtin`).not.toMatch(/from "node:/);
    }
  });
});
