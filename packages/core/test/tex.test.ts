import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDateRange, parseTexDate, parseTexResume } from "../src/ingest/tex.js";
import { ResumeDoc } from "../src/resume.js";

/**
 * Acceptance tests for O-03: the A-04 golden .tex fixtures with their
 * hand-written expected ResumeDoc JSON (corrected per ADR D-023 — the
 * originals asserted fields not derivable from the .tex source).
 * Both sides go through ResumeDoc.parse so schema defaults normalize.
 */
const TEX_DIR = join(__dirname, "../../evals/golden/tex");

const FIXTURES = [
  "jakes-clean-swe",
  "jakes-no-gpa",
  "jakes-no-projects",
  "jakes-two-page",
  "jakes-unquantified",
  // B-3 / A-14: non-Jake's real-world layouts (custom envs + tabularx; and a
  // title-first \resumeSubheading with plain itemize bullets + tabular skills).
  "custom-envs-tabularx",
  "subheading-itemize",
];

describe("parseTexResume acceptance (A-04 golden fixtures)", () => {
  for (const stem of FIXTURES) {
    it(`${stem}.tex → expected ResumeDoc`, () => {
      const source = readFileSync(join(TEX_DIR, `${stem}.tex`), "utf8");
      const expected = ResumeDoc.parse(
        JSON.parse(readFileSync(join(TEX_DIR, `${stem}.json`), "utf8")),
      );
      expect(parseTexResume(source)).toEqual(expected);
    });
  }
});

describe("date parsing", () => {
  it("month-year forms", () => {
    expect(parseTexDate("Aug. 2022")).toBe("2022-08");
    expect(parseTexDate("May 2026")).toBe("2026-05");
    expect(parseTexDate("Sept 2024")).toBe("2024-09");
    expect(parseTexDate("2023")).toBe("2023");
    expect(parseTexDate("garbled")).toBeNull();
  });

  it("ranges, single dates, and Present", () => {
    expect(parseDateRange("Aug. 2022 -- May 2026")).toEqual({
      startDate: "2022-08",
      endDate: "2026-05",
    });
    expect(parseDateRange("Aug. 2024")).toEqual({ startDate: "2024-08", endDate: "2024-08" });
    expect(parseDateRange("Jun. 2025 -- Present")).toEqual({ startDate: "2025-06" });
  });
});

describe("parser details", () => {
  const source = readFileSync(join(TEX_DIR, "jakes-clean-swe.tex"), "utf8");
  const doc = parseTexResume(source);

  it("extracts GPA from the degree line", () => {
    expect(doc.education[0]?.gpa).toEqual({ value: 3.7, scale: 4.0 });
    expect(doc.education[0]?.studyType).toBe("Bachelor of Science");
    expect(doc.education[0]?.area).toBe("Computer Science");
  });

  it("classifies contact hrefs into email and profiles", () => {
    expect(doc.basics.email).toBe("student@example.edu");
    expect(doc.basics.profiles.map((p) => p.network).sort()).toEqual(["GitHub", "LinkedIn"]);
  });

  it("builds a 1-indexed inclusive source map covering every section", () => {
    const map = Object.fromEntries(
      doc.meta.texSourceMap.map((r) => [r.section, [r.startLine, r.endLine]]),
    );
    expect(map).toEqual({
      basics: [18, 24],
      education: [25, 31],
      work: [32, 41],
      projects: [42, 50],
      skills: [51, 58],
    });
  });

  it("omits pageCount (unknowable without compiling) and detects no false signals", () => {
    expect(doc.meta.regionSignals.pageCount).toBeUndefined();
    expect(doc.meta.regionSignals.hasPhoto).toBe(false);
    expect(doc.meta.regionSignals.hasDeclarationLine).toBe(false);
  });
});
