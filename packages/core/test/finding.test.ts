import { describe, expect, it } from "vitest";
import { Finding, FindingSource, Report, ResumeSection } from "../src/finding.js";

/**
 * Contract for the D-039 additive schema: findings carry an optional section,
 * sources allow deterministic impact:/findability: forms, and reports carry an
 * overall + per-section sub-scores. All additive — existing shapes still parse.
 */
describe("D-039 scoring schema (additive)", () => {
  it("accepts the new deterministic source forms", () => {
    for (const s of [
      "impact:weak-verbs",
      "findability:keyword-coverage",
      "fidelity:multi-column",
      "rulepack:region/us#us-no-photo",
      "llm",
    ]) {
      expect(FindingSource.safeParse(s).success).toBe(true);
    }
    expect(FindingSource.safeParse("impact: has spaces").success).toBe(false);
    expect(FindingSource.safeParse("nonsense").success).toBe(false);
  });

  it("a finding may carry a section, and may omit it (back-compat)", () => {
    const base = {
      id: "imp-q-01",
      layer: "impact" as const,
      priority: "P1" as const,
      title: "Bullets rarely quantify outcomes",
      evidence: "3 of 5 bullets contain no numbers",
      why: "Numbers turn a claim into evidence.",
      source: "impact:quantification-density",
    };
    expect(Finding.safeParse({ ...base, section: "experience" }).success).toBe(true);
    expect(Finding.safeParse(base).success).toBe(true);
    expect(Finding.safeParse({ ...base, section: "not-a-section" }).success).toBe(false);
  });

  it("ResumeSection is the student-centric set", () => {
    expect(ResumeSection.options).toEqual([
      "contact",
      "experience",
      "projects",
      "skills",
      "education",
      "format",
    ]);
  });

  it("a report may carry overall + per-section scores, or neither", () => {
    const withScores = Report.safeParse({
      scores: { fidelity: 100 },
      overall: 74,
      sections: { experience: 80, projects: 68, format: 100 },
      findings: [],
      contextUsed: { region: "us", role: "swe-intern" },
    });
    expect(withScores.success).toBe(true);

    const degradedLegacy = Report.safeParse({
      scores: { fidelity: 100 },
      findings: [],
      contextUsed: { region: "us", role: "swe-intern" },
    });
    expect(degradedLegacy.success).toBe(true);

    const outOfRange = Report.safeParse({
      scores: {},
      overall: 140,
      findings: [],
      contextUsed: { region: "us", role: "swe-intern" },
    });
    expect(outOfRange.success).toBe(false);
  });
});
