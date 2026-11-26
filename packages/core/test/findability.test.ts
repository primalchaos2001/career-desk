import { describe, expect, it } from "vitest";
import { analyzeFindability } from "../src/analyze/findability.js";
import { makeDoc } from "./helpers.js";

const sources = (fs: { source: string }[]) => fs.map((f) => f.source);

const KW = [
  { term: "REST API", aliases: ["REST", "API"] },
  { term: "SQL" },
  { term: "Docker" },
  { term: "CI/CD", aliases: ["continuous integration"] },
];

describe("analyzeFindability (D-039 findability analyzer)", () => {
  it("flags low recruiter-keyword coverage and lists the missing terms", () => {
    const doc = makeDoc({
      skills: [{ name: "Languages", keywords: ["Python"] }],
      work: [{ name: "Acme", highlights: ["Built a REST API for the billing team"] }],
    });
    const { findings, signals } = analyzeFindability(doc, { keywords: KW });

    expect(sources(findings)).toContain("findability:keyword-coverage");
    // "REST API" is covered by the highlight; SQL/Docker/CI-CD are not.
    expect(signals.keywordCoverage).toBeCloseTo(0.25, 2);
    expect(signals.missingKeywords).toEqual(expect.arrayContaining(["SQL", "Docker", "CI/CD"]));
    expect(signals.missingKeywords).not.toContain("REST API");
    const f = findings.find((x) => x.source === "findability:keyword-coverage");
    expect(f?.section).toBe("skills");
  });

  it("stays quiet when coverage is high", () => {
    const doc = makeDoc({
      skills: [{ name: "Tech", keywords: ["SQL", "Docker"] }],
      work: [{ name: "Acme", highlights: ["Set up CI/CD and a REST API"] }],
    });
    const { findings, signals } = analyzeFindability(doc, { keywords: KW });
    expect(signals.keywordCoverage).toBe(1);
    expect(sources(findings)).not.toContain("findability:keyword-coverage");
  });

  it("flags job-description keyword gaps when a JD is pasted", () => {
    const doc = makeDoc({
      skills: [{ name: "Tech", keywords: ["Python"] }],
      work: [{ name: "Acme", highlights: ["Built data pipelines in Python"] }],
    });
    const jd =
      "We need strong Kubernetes and Terraform experience, plus PostgreSQL for our data platform.";
    const { findings, signals } = analyzeFindability(doc, { jobDescription: jd });

    expect(sources(findings).some((s) => s.startsWith("jd:"))).toBe(true);
    expect(signals.missingJdTerms).toEqual(
      expect.arrayContaining(["kubernetes", "terraform", "postgresql"]),
    );
  });

  it("reports contact/link signals for the contact section score", () => {
    const withGh = analyzeFindability(makeDoc(), {});
    expect(withGh.signals.hasGithub).toBe(true);

    const noGh = analyzeFindability(makeDoc({ basics: { profiles: [] } }), {});
    expect(noGh.signals.hasGithub).toBe(false);
  });
});
