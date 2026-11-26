import { describe, expect, it } from "vitest";
import { analyzeImpact } from "../src/analyze/impact.js";
import { makeDoc } from "./helpers.js";

const ids = (fs: { source: string }[]) => fs.map((f) => f.source);

describe("analyzeImpact (D-039 impact analyzers)", () => {
  it("flags unquantified, weak-verb experience bullets and scores the signals low", () => {
    const doc = makeDoc({
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: [
            "Responsible for maintaining the internal dashboard",
            "Worked on various backend tasks and helped the team",
            "Assisted with testing and documentation",
          ],
        },
      ],
    });
    const { findings, sections } = analyzeImpact(doc);

    expect(ids(findings)).toContain("impact:quantification-density");
    expect(ids(findings)).toContain("impact:weak-verbs");
    // section attribution: these are work bullets → experience
    for (const f of findings) expect(f.section).toBe("experience");

    // D-064: evidence quotes a real bullet, not just a count — so AI
    // enrichment has actual résumé text to rewrite.
    const quant = findings.find((f) => f.source === "impact:quantification-density");
    expect(quant?.evidence).toMatch(/e\.g\. ".+"/);

    const exp = sections.experience;
    expect(exp).toBeDefined();
    expect(exp?.bulletCount).toBe(3);
    expect(exp?.quantifiedRatio).toBe(0); // no digits anywhere
    expect(exp?.strongVerbRatio).toBe(0); // no strong lead verbs
    expect(exp?.weakVerbCount).toBeGreaterThanOrEqual(2);
  });

  it("stays quiet on strong, quantified bullets", () => {
    const doc = makeDoc({
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: [
            "Cut p95 API latency 38% by adding a Redis cache",
            "Shipped 12 features and reduced 5xx errors from 1.2% to 0.3%",
            "Automated the release pipeline, saving 6 engineer-hours per week",
          ],
        },
      ],
    });
    const { findings, sections } = analyzeImpact(doc);

    expect(ids(findings)).not.toContain("impact:quantification-density");
    expect(ids(findings)).not.toContain("impact:weak-verbs");
    expect(sections.experience?.quantifiedRatio).toBe(1);
    expect(sections.experience?.strongVerbRatio).toBeGreaterThan(0.9);
  });

  it("flags filler/clichés wherever they appear", () => {
    const doc = makeDoc({
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: [
            "Built an ETL pipeline processing 2M rows/day; a real team player and hard worker",
          ],
        },
      ],
    });
    const { findings } = analyzeImpact(doc);
    expect(ids(findings)).toContain("impact:filler");
  });

  it("attributes project-bullet findings to the projects section", () => {
    const doc = makeDoc({
      projects: [
        {
          name: "Todo App",
          highlights: ["Responsible for the frontend", "Worked on styling and layout tweaks"],
        },
      ],
    });
    const { findings, sections } = analyzeImpact(doc);
    const weak = findings.find((f) => f.source === "impact:weak-verbs");
    expect(weak?.section).toBe("projects");
    expect(sections.projects?.bulletCount).toBe(2);
  });

  it("recognizes spelling variants (US vs UK) of strong verbs", () => {
    const doc = makeDoc({
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: [
            "Optimised performance of the rendering engine",
            "Optimized performance of the storage layer",
            "Analysed customer transaction trends",
            "Analyzed client server logs",
          ],
        },
      ],
    });
    const { findings, sections } = analyzeImpact(doc);
    expect(ids(findings)).not.toContain("impact:weak-verbs");
    expect(sections.experience?.strongVerbRatio).toBe(1.0);
  });

  it("quotes an over-long bullet in evidence, not just the count (D-064)", () => {
    const longBullet =
      "Worked with a large cross-functional team across multiple departments and time zones to " +
      "help design, build, test, and eventually deploy a new internal tool used for tracking " +
      "things across the organization, coordinating with stakeholders in several other groups " +
      "along the way to make sure requirements were gathered correctly";
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Intern", highlights: [longBullet] }],
    });
    const { findings } = analyzeImpact(doc);
    const lengthFinding = findings.find((f) => f.source === "impact:bullet-length");
    expect(lengthFinding?.evidence).toMatch(/e\.g\. ".+"/);
  });

  it("recognizes new weak openers, lead words, and filler phrases", () => {
    const doc = makeDoc({
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: [
            "Gained experience in writing unit tests for core services",
            "Quick learner who built database schemas",
          ],
        },
      ],
    });
    const { findings } = analyzeImpact(doc);
    expect(ids(findings)).toContain("impact:weak-verbs");
    expect(ids(findings)).toContain("impact:filler");
  });
});
