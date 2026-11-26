import { describe, expect, it } from "vitest";
import { Finding, Report, ResumeDoc } from "../src/index.js";
import minimal from "./fixtures/minimal-student.json";
import rich from "./fixtures/rich-newgrad.json";

describe("ResumeDoc round-trip", () => {
  for (const [name, fixture] of [
    ["minimal-student", minimal],
    ["rich-newgrad", rich],
  ] as const) {
    it(`${name}: parses, and re-parsing its output is lossless`, () => {
      const parsed = ResumeDoc.parse(fixture);
      const reparsed = ResumeDoc.parse(JSON.parse(JSON.stringify(parsed)));
      expect(reparsed).toEqual(parsed);
    });
  }

  it("rejects a resume without basics.name", () => {
    expect(() => ResumeDoc.parse({ basics: {}, meta: { sourceFormat: "pdf" } })).toThrow();
  });

  it("rejects an unknown sourceFormat", () => {
    expect(() =>
      ResumeDoc.parse({ basics: { name: "A" }, meta: { sourceFormat: "html" } }),
    ).toThrow();
  });

  it("rejects malformed dates", () => {
    expect(() =>
      ResumeDoc.parse({
        basics: { name: "A" },
        education: [{ institution: "X", startDate: "June 2024" }],
        meta: { sourceFormat: "builder" },
      }),
    ).toThrow();
  });
});

describe("Finding/Report", () => {
  const finding = {
    id: "reg-us-photo-001",
    layer: "context",
    priority: "P0",
    title: "Photo on a US resume",
    evidence: "Image detected in header region, page 1",
    why: "US employers discard photo resumes for bias-liability reasons",
    source: "rulepack:region/us#photo",
    suggestion: { before: "photo in header", after: "no photo" },
  };

  it("accepts a well-formed finding", () => {
    expect(Finding.parse(finding)).toMatchObject({ id: "reg-us-photo-001" });
  });

  it("rejects an invalid provenance source", () => {
    expect(() => Finding.parse({ ...finding, source: "gut-feeling" })).toThrow();
  });

  it("accepts a degraded report with partial scores", () => {
    const report = Report.parse({
      scores: { fidelity: 88 },
      findings: [finding],
      contextUsed: { region: "us", role: "swe-intern" },
      degraded: true,
    });
    expect(report.degraded).toBe(true);
    expect(report.scores.impact).toBeUndefined();
  });
});
