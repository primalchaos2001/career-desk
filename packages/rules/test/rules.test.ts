import type { ResumeDoc } from "@tailorats/core";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine.js";
import { loadAllPacks, loadPack } from "../src/node.js";
import { makeDoc } from "./helpers.js";

/**
 * Every rule in every seed pack ships with a positive fixture (triggers) and
 * a negative fixture (does not trigger). Adding a rule without extending this
 * table fails the completeness test at the bottom.
 */
const cases: Record<string, { pack: string; positive: ResumeDoc; negative: ResumeDoc }> = {
  "us-no-photo": {
    pack: "region/us",
    positive: makeDoc({ regionSignals: { hasPhoto: true } }),
    negative: makeDoc(),
  },
  "us-no-personal-details": {
    pack: "region/us",
    positive: makeDoc({ regionSignals: { hasDateOfBirth: true, hasMaritalStatus: true } }),
    negative: makeDoc(),
  },
  "us-one-page": {
    pack: "region/us",
    positive: makeDoc({ regionSignals: { pageCount: 2 } }),
    negative: makeDoc({ regionSignals: { pageCount: 1 } }),
  },
  "us-spelling": {
    pack: "region/us",
    positive: makeDoc({ regionSignals: { spellingVariant: "en-GB" } }),
    negative: makeDoc({ regionSignals: { spellingVariant: "en-US" } }),
  },
  "us-no-declaration": {
    pack: "region/us",
    positive: makeDoc({ regionSignals: { hasDeclarationLine: true } }),
    negative: makeDoc(),
  },
  "in-two-pages": {
    pack: "region/india",
    positive: makeDoc({ regionSignals: { pageCount: 3 } }),
    negative: makeDoc({ regionSignals: { pageCount: 2 } }),
  },
  // D-044: India accepts either convention consistently; only mixed fires.
  "in-spelling": {
    pack: "region/india",
    positive: makeDoc({ regionSignals: { spellingVariant: "mixed" } }),
    negative: makeDoc({ regionSignals: { spellingVariant: "en-US" } }),
  },
  "uk-no-photo": {
    pack: "region/uk",
    positive: makeDoc({ regionSignals: { hasPhoto: true } }),
    negative: makeDoc(),
  },
  "uk-no-personal-details": {
    pack: "region/uk",
    positive: makeDoc({ regionSignals: { hasDateOfBirth: true } }),
    negative: makeDoc(),
  },
  "uk-page-count": {
    pack: "region/uk",
    positive: makeDoc({ regionSignals: { pageCount: 3 } }),
    negative: makeDoc({ regionSignals: { pageCount: 2 } }),
  },
  "uk-spelling": {
    pack: "region/uk",
    positive: makeDoc({ regionSignals: { spellingVariant: "en-US" } }),
    negative: makeDoc({ regionSignals: { spellingVariant: "en-GB" } }),
  },
  "uk-no-declaration": {
    pack: "region/uk",
    positive: makeDoc({ regionSignals: { hasDeclarationLine: true } }),
    negative: makeDoc(),
  },
  "de-page-count": {
    pack: "region/de",
    positive: makeDoc({ regionSignals: { pageCount: 3 } }),
    negative: makeDoc({ regionSignals: { pageCount: 2 } }),
  },
  "de-spelling": {
    pack: "region/de",
    positive: makeDoc({ regionSignals: { spellingVariant: "en-US" } }),
    negative: makeDoc({ regionSignals: { spellingVariant: "en-GB" } }),
  },
  "de-no-declaration": {
    pack: "region/de",
    positive: makeDoc({ regionSignals: { hasDeclarationLine: true } }),
    negative: makeDoc(),
  },
  "da-sql-required": {
    pack: "role/data-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["sql"] }] }),
  },
  "da-visualization-required": {
    pack: "role/data-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["sql"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["tableau"] }] }),
  },
  "fa-gpa-required": {
    pack: "role/finance-analyst",
    positive: makeDoc({ education: [{ institution: "U" }] }),
    negative: makeDoc({ education: [{ institution: "U", gpa: { value: 3.5, scale: 4 } }] }),
  },
  "fa-excel-modeling-required": {
    pack: "role/finance-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["finance"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["excel"] }] }),
  },
  "fa-certifications-recommended": {
    pack: "role/finance-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["finance"] }], certificates: [] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["cfa"] }] }),
  },
  "fin-no-photo": {
    pack: "industry/finance",
    positive: makeDoc({ regionSignals: { hasPhoto: true } }),
    negative: makeDoc(),
  },
  "fin-one-page": {
    pack: "industry/finance",
    positive: makeDoc({ regionSignals: { pageCount: 2 } }),
    negative: makeDoc({ regionSignals: { pageCount: 1 } }),
  },
  "ib-quantify-bullets": {
    pack: "role/ib-analyst",
    positive: makeDoc({
      projects: [{ name: "p", highlights: ["Bullet point without numbers"] }],
    }),
    negative: makeDoc({
      projects: [{ name: "p", highlights: ["Bullet point with 123 numbers"] }],
    }),
  },
  "ib-excel-modeling-required": {
    pack: "role/ib-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["finance"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["excel"] }] }),
  },
  "ib-certifications-recommended": {
    pack: "role/ib-analyst",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["finance"] }], certificates: [] }),
    negative: (() => {
      const doc = makeDoc({ skills: [] });
      doc.certificates = [{ name: "CFA", issuer: "CFA", date: "2024" }];
      return doc;
    })(),
  },
  "swe-projects-required": {
    pack: "role/swe-intern",
    positive: makeDoc({ projects: [] }),
    negative: makeDoc(),
  },
  "swe-github-link": {
    pack: "role/swe-intern",
    positive: makeDoc({
      basics: { profiles: [] },
      projects: [{ name: "p", url: "https://d.example" }],
    }),
    negative: makeDoc(),
  },
  "swe-project-links": {
    pack: "role/swe-intern",
    positive: makeDoc({ projects: [{ name: "unlinked-proj" }] }),
    negative: makeDoc(),
  },
  "stu-gpa": {
    pack: "stage/student",
    positive: makeDoc({ education: [{ institution: "U", area: "CS", coursework: ["Algo"] }] }),
    negative: makeDoc(),
  },
  "stu-coursework": {
    pack: "stage/student",
    positive: makeDoc({ education: [{ institution: "U", gpa: { value: 3.5, scale: 4 } }] }),
    negative: makeDoc(),
  },
  "stu-quantify": {
    pack: "stage/student",
    positive: makeDoc({
      projects: [
        {
          name: "p",
          githubUrl: "https://github.com/t/p",
          highlights: ["worked on backend", "helped with testing"],
        },
      ],
    }),
    negative: makeDoc(),
  },
  "stu-certificates-unlinked": {
    pack: "stage/student",
    positive: makeDoc({
      certificates: [{ name: "AWS Certified Developer" }],
    }),
    negative: makeDoc({
      certificates: [{ name: "AWS Certified Developer", url: "https://verify.aws/123" }],
    }),
  },
  "mech-cad-fea-required": {
    pack: "role/mech-engineer-intern",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["solidworks"] }] }),
  },
  "mech-fe-eit-recommended": {
    pack: "role/mech-engineer-intern",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }], certificates: [] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["fe exam"] }] }),
  },
  "mech-projects-required": {
    pack: "role/mech-engineer-intern",
    positive: makeDoc({ projects: [] }),
    negative: makeDoc(),
  },
  "mech-work-experience-recommended": {
    pack: "role/mech-engineer-intern",
    positive: makeDoc({ work: [] }),
    negative: makeDoc({ work: [{ name: "Acme", position: "Intern", highlights: [] }] }),
  },
  "ee-lab-pcb-hdl-required": {
    pack: "role/ee-intern",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["altium"] }] }),
  },
  "ee-fe-eit-recommended": {
    pack: "role/ee-intern",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }], certificates: [] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["eit"] }] }),
  },
  "ee-projects-required": {
    pack: "role/ee-intern",
    positive: makeDoc({ projects: [] }),
    negative: makeDoc(),
  },
  "ee-work-experience-recommended": {
    pack: "role/ee-intern",
    positive: makeDoc({ work: [] }),
    negative: makeDoc({ work: [{ name: "Acme", position: "Intern", highlights: [] }] }),
  },
  "dv-lab-tools-required": {
    pack: "role/dv-engineer",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["systemverilog"] }] }),
  },
  "dv-verification-methodology-recommended": {
    pack: "role/dv-engineer",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["uvm"] }] }),
  },
  "dv-synthesis-simulation-tools-recommended": {
    pack: "role/dv-engineer",
    positive: makeDoc({ skills: [{ name: "s", keywords: ["python"] }] }),
    negative: makeDoc({ skills: [{ name: "s", keywords: ["vivado"] }] }),
  },
  "dv-projects-required": {
    pack: "role/dv-engineer",
    positive: makeDoc({ projects: [] }),
    negative: makeDoc(),
  },
  "dv-work-experience-recommended": {
    pack: "role/dv-engineer",
    positive: makeDoc({ work: [] }),
    negative: makeDoc({ work: [{ name: "Acme", position: "Intern", highlights: [] }] }),
  },
  "con-one-page": {
    pack: "industry/consulting",
    positive: makeDoc({ regionSignals: { pageCount: 2 } }),
    negative: makeDoc({ regionSignals: { pageCount: 1 } }),
  },
  "con-no-photo": {
    pack: "industry/consulting",
    positive: makeDoc({ regionSignals: { hasPhoto: true } }),
    negative: makeDoc(),
  },
  "con-quantify-bullets": {
    pack: "role/consulting-analyst",
    positive: makeDoc({ projects: [{ name: "p", highlights: ["Bullet point without numbers"] }] }),
    negative: makeDoc({ projects: [{ name: "p", highlights: ["Bullet point with 123 numbers"] }] }),
  },
  "con-leadership-evidence": {
    pack: "role/consulting-analyst",
    positive: makeDoc({
      work: [{ name: "Acme", position: "Software Developer", highlights: [] }],
      awards: [],
      projects: [{ name: "P1", roles: ["Contributor"] }],
    }),
    negative: makeDoc({
      work: [{ name: "Acme", position: "Lead Developer", highlights: [] }],
      awards: [],
      projects: [{ name: "P1", roles: ["Contributor"] }],
    }),
  },
  "mba-quantify-business-impact": {
    pack: "role/mba-applicant",
    positive: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Led project on standard bugs", "Worked on some tasks"],
        },
      ],
    }),
    negative: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Increased sales by 15%", "Managed a budget of $5M"],
        },
      ],
    }),
  },
  "mba-leadership-scope-required": {
    pack: "role/mba-applicant",
    positive: makeDoc({
      work: [
        {
          name: "Acme",
          position: "Developer",
          highlights: ["Fixed some bugs", "Supported codebase"],
        },
      ],
    }),
    negative: makeDoc({
      work: [{ name: "Acme", position: "Team Lead", highlights: ["Managed developers"] }],
    }),
  },
  "mba-career-progression-recommended": {
    pack: "role/mba-applicant",
    positive: makeDoc({
      work: [{ name: "Acme", position: "Developer", highlights: ["Developed core features"] }],
    }),
    negative: makeDoc({
      work: [{ name: "Acme", position: "Developer", highlights: ["Promoted to Lead Developer"] }],
    }),
  },
  "mba-extracurricular-impact-recommended": {
    pack: "role/mba-applicant",
    positive: makeDoc({
      work: [{ name: "Acme", position: "Developer", highlights: [] }],
      awards: [],
    }),
    negative: makeDoc({
      work: [{ name: "Acme", position: "Developer", highlights: [] }],
      awards: [{ title: "Community Service Award" }],
    }),
  },
  "pm-outcome-metrics": {
    pack: "role/product-manager",
    positive: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Shipped search features", "Documented requirements"],
        },
      ],
    }),
    negative: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Increased conversion rate by 15%", "Launched features to 10M DAU"],
        },
      ],
    }),
  },
  "pm-user-evidence": {
    pack: "role/product-manager",
    positive: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Fixed bugs", "Documented requirements"],
        },
      ],
    }),
    negative: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Conducted user interviews with 40 customers", "Ran A/B testing"],
        },
      ],
    }),
  },
  "pm-cross-functional-scope": {
    pack: "role/product-manager",
    positive: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: ["Fixed bugs", "Documented requirements"],
        },
      ],
    }),
    negative: makeDoc({
      work: [
        {
          name: "Acme",
          position: "PM",
          highlights: [
            "Aligned cross-functional team of engineers and designers",
            "Managed stakeholder expectations",
          ],
        },
      ],
    }),
  },
};

describe("seed rules: positive/negative fixtures", () => {
  for (const [ruleId, { pack, positive, negative }] of Object.entries(cases)) {
    const packs = [loadPack(pack)];
    it(`${ruleId} triggers on its positive fixture`, () => {
      expect(evaluate(positive, packs).map((f) => f.id)).toContain(ruleId);
    });
    it(`${ruleId} stays silent on its negative fixture`, () => {
      expect(evaluate(negative, packs).map((f) => f.id)).not.toContain(ruleId);
    });
  }
});

describe("pack integrity", () => {
  it("all packs load, validate, and reference only registered checks", () => {
    const packs = loadAllPacks();
    expect(packs.length).toBeGreaterThanOrEqual(4);
    // evaluate() throws on unknown checks; a clean doc across all packs must not throw
    expect(() => evaluate(makeDoc(), packs)).not.toThrow();
  });

  it("every rule cites a source URL", () => {
    for (const pack of loadAllPacks()) {
      for (const rule of pack.rules) {
        expect(rule.source.url, `${pack.pack}#${rule.id}`).toMatch(/^https?:\/\//);
      }
    }
  });

  it("every seed rule has a fixture pair in this suite", () => {
    const covered = new Set(Object.keys(cases));
    for (const pack of loadAllPacks()) {
      for (const rule of pack.rules) {
        expect(covered.has(rule.id), `missing fixtures for ${pack.pack}#${rule.id}`).toBe(true);
      }
    }
  });
});
