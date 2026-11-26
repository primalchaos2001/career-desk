import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ResumeDoc } from "@tailorats/core";
import { loadPack } from "@tailorats/rules/node";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

/**
 * D-039 calibration guard: the deterministic scoring engine must keep a clear
 * gap between a strong résumé and weak ones on the real golden fixtures. A
 * heuristic scorer drifts silently without bands like these (D-020/D-021), so
 * these thresholds are the contract — retune the weights/formulas here when
 * they legitimately move.
 */

const goldenDoc = (name: string): ResumeDoc =>
  ResumeDoc.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../evals/golden/tex/${name}`, import.meta.url)),
        "utf8",
      ),
    ),
  );

const packs = [loadPack("stage/student"), loadPack("role/swe-intern"), loadPack("region/us")];
const context = { region: "us", role: "swe-intern", stage: "student" };

async function report(name: string) {
  const { report } = await analyze({
    source: { kind: "resumedoc", doc: goldenDoc(name) },
    context,
    packs,
  });
  return report;
}

describe("D-039 golden score bands", () => {
  it("a clean, quantified SWE résumé scores well overall (>= 78)", async () => {
    const r = await report("jakes-clean-swe.json");
    expect(r.overall ?? 0).toBeGreaterThanOrEqual(78);
    expect(r.sections?.format).toBe(100);
  });

  it("an unquantified, weak-verb résumé scores materially lower", async () => {
    const r = await report("jakes-unquantified.json");
    expect(r.overall ?? 100).toBeLessThanOrEqual(66);
    expect(r.sections?.experience ?? 100).toBeLessThan(55);
  });

  it("a résumé missing projects tanks the Projects section", async () => {
    const r = await report("jakes-no-projects.json");
    expect(r.sections?.projects ?? 100).toBeLessThan(30);
    expect(r.overall ?? 100).toBeLessThanOrEqual(66);
  });

  it("the strong résumé out-scores both weak ones by a clear margin", async () => {
    const [clean, unq, noProj] = await Promise.all([
      report("jakes-clean-swe.json"),
      report("jakes-unquantified.json"),
      report("jakes-no-projects.json"),
    ]);
    expect(clean.overall ?? 0).toBeGreaterThan((unq.overall ?? 0) + 12);
    expect(clean.overall ?? 0).toBeGreaterThan((noProj.overall ?? 0) + 12);
  });
});
