import { describe, expect, it } from "vitest";
import { analyzeFindability } from "../src/analyze/findability.js";
import { analyzeImpact } from "../src/analyze/impact.js";
import { scoreResume } from "../src/analyze/score.js";
import { makeDoc } from "./helpers.js";

const strongDoc = makeDoc({
  basics: {
    profiles: [
      { network: "GitHub", url: "https://github.com/x" },
      { network: "LinkedIn", url: "https://linkedin.com/in/x" },
    ],
  },
  work: [
    {
      name: "Acme",
      position: "SWE Intern",
      highlights: [
        "Cut p95 API latency 38% by adding a Redis cache",
        "Shipped 12 features and reduced 5xx errors from 1.2% to 0.3%",
      ],
    },
  ],
  projects: [
    {
      name: "Grader",
      githubUrl: "https://github.com/x/grader",
      highlights: ["Built a CI/CD pipeline processing 2M events/day"],
    },
  ],
  skills: [{ name: "Tech", keywords: ["Python", "SQL", "Docker"] }],
  education: [
    { institution: "U", area: "CS", gpa: { value: 3.8, scale: 4 }, coursework: ["Algorithms"] },
  ],
});

const weakDoc = makeDoc({
  basics: { profiles: [] },
  work: [
    {
      name: "Acme",
      position: "Intern",
      highlights: [
        "Responsible for maintaining the dashboard",
        "Worked on various tasks and a real team player",
      ],
    },
  ],
  projects: [{ name: "Todo", highlights: ["Helped with the frontend"] }],
  skills: [{ name: "Skills", keywords: ["teamwork"] }],
  education: [{ institution: "U", area: "CS" }],
});

function score(doc: typeof strongDoc, stage = "student") {
  const impact = analyzeImpact(doc);
  const findability = analyzeFindability(doc, {});
  return scoreResume({
    doc,
    impact,
    findability,
    fidelityScore: 100,
    findings: [...impact.findings, ...findability.findings],
    context: { stage, role: "swe-intern" },
  });
}

describe("scoreResume (D-039 section scorer)", () => {
  it("scores a strong résumé high overall and a weak one low", () => {
    const strong = score(strongDoc);
    const weak = score(weakDoc);
    expect(strong.overall).toBeGreaterThanOrEqual(80);
    expect(weak.overall).toBeLessThanOrEqual(55);
    expect(strong.overall).toBeGreaterThan(weak.overall + 20);
  });

  it("tanks the section responsible for a weakness", () => {
    const weak = score(weakDoc);
    // weak experience writing → low Experience sub-score
    expect(weak.sections.experience ?? 100).toBeLessThan(60);
    // strong résumé's experience scores well
    expect(score(strongDoc).sections.experience ?? 0).toBeGreaterThanOrEqual(80);
  });

  it("always scores the format section (document-wide) and keeps scores in range", () => {
    const s = score(strongDoc);
    expect(s.sections.format).toBe(100);
    for (const v of Object.values(s.sections)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(s.overall).toBeGreaterThanOrEqual(0);
    expect(s.overall).toBeLessThanOrEqual(100);
  });

  it("weights lean on Experience for new-grads vs Projects for students", () => {
    // Strong experience, no projects: a new-grad (experience-weighted) should
    // out-score a student (projects-weighted) on the same résumé.
    const expStrongNoProjects = makeDoc({
      basics: {
        profiles: [
          { network: "GitHub", url: "https://github.com/x" },
          { network: "LinkedIn", url: "https://linkedin.com/in/x" },
        ],
      },
      work: [
        {
          name: "Acme",
          position: "SWE Intern",
          highlights: [
            "Cut p95 API latency 38% by adding a Redis cache",
            "Automated releases, saving 6 engineer-hours per week",
          ],
        },
      ],
      projects: [],
      education: [{ institution: "U", area: "CS", gpa: { value: 3.8, scale: 4 } }],
    });
    const student = score(expStrongNoProjects, "student");
    const newGrad = score(expStrongNoProjects, "new-grad");
    expect(newGrad.overall).toBeGreaterThan(student.overall);
  });

  it("D-043: mba weights (keyed by role, not stage) deprioritize Projects and lean on Experience", () => {
    // A projects-heavy, engineering-flavored résumé with a thin, unquantified
    // Experience section — the exact "same résumé, same result" complaint
    // (B-2): under the mba-applicant role it should score meaningfully lower
    // than under swe-intern, since projects (strong here) count for much less
    // and experience (weak here) counts for much more. MBA is a role choice
    // (target audience), not a career stage — a student can apply MBA-framed.
    const engineeringResume = makeDoc({
      basics: {
        profiles: [
          { network: "GitHub", url: "https://github.com/x" },
          { network: "LinkedIn", url: "https://linkedin.com/in/x" },
        ],
      },
      work: [
        {
          name: "Acme",
          position: "Intern",
          highlights: ["Helped with backend tasks", "Worked on the dashboard"],
        },
      ],
      projects: [
        {
          name: "Grader",
          githubUrl: "https://github.com/x/grader",
          highlights: [
            "Cut schedule generation from 40s to 2s with memoized backtracking",
            "Built a CI/CD pipeline processing 2M events/day",
          ],
        },
      ],
      education: [{ institution: "U", area: "CS", gpa: { value: 3.8, scale: 4 } }],
    });
    const impact = analyzeImpact(engineeringResume);
    const findability = analyzeFindability(engineeringResume, {});
    const scoreAs = (role: string) =>
      scoreResume({
        doc: engineeringResume,
        impact,
        findability,
        fidelityScore: 100,
        findings: [...impact.findings, ...findability.findings],
        context: { stage: "student", role },
      });
    const student = scoreAs("swe-intern");
    const mba = scoreAs("mba-applicant");
    expect(mba.overall).toBeLessThan(student.overall);
  });
});

describe("scoreResume readouts (D-042 per-section strengths/gaps)", () => {
  it("emits one readout per scored section, each with a non-empty benchmark", () => {
    const s = score(strongDoc);
    expect(s.readouts.length).toBe(Object.keys(s.sections).length);
    for (const r of s.readouts) {
      expect(s.sections[r.section]).toBe(r.score);
      expect(r.benchmark.length).toBeGreaterThan(0);
    }
  });

  it("credits quantified, strong-verb Experience bullets as a strength, not a gap", () => {
    const s = score(strongDoc);
    const exp = s.readouts.find((r) => r.section === "experience");
    expect(exp?.strengths.some((t) => /quantif/i.test(t))).toBe(true);
    expect(exp?.gaps.some((t) => /quantif/i.test(t))).toBe(false);
  });

  it("flags weak/unquantified Experience bullets as a gap, not a strength", () => {
    const s = score(weakDoc);
    const exp = s.readouts.find((r) => r.section === "experience");
    expect(exp?.gaps.length).toBeGreaterThan(0);
    expect(exp?.strengths.some((t) => /quantif/i.test(t))).toBe(false);
  });

  it("gaps a missing Projects section instead of silently scoring it low", () => {
    const doc = makeDoc({ projects: [] });
    const s = score(doc);
    const proj = s.readouts.find((r) => r.section === "projects");
    expect(proj?.gaps.some((t) => /project/i.test(t))).toBe(true);
  });

  it("credits full contact linkage as a strength and gaps missing links", () => {
    const linked = score(strongDoc); // GitHub + LinkedIn
    const contactLinked = linked.readouts.find((r) => r.section === "contact");
    expect(contactLinked?.strengths.some((t) => /github/i.test(t))).toBe(true);

    const bare = score(makeDoc({ basics: { profiles: [] } }));
    const contactBare = bare.readouts.find((r) => r.section === "contact");
    expect(contactBare?.gaps.some((t) => /github/i.test(t))).toBe(true);
  });

  it("credits GPA + coursework as an Education strength; gaps either when missing", () => {
    const full = score(strongDoc); // has gpa + coursework
    expect(
      full.readouts
        .find((r) => r.section === "education")
        ?.strengths.some((t) => /gpa|coursework/i.test(t)),
    ).toBe(true);

    const bare = score(makeDoc({ education: [{ institution: "U", area: "CS" }] }));
    const eduBare = bare.readouts.find((r) => r.section === "education");
    expect(eduBare?.gaps.length).toBeGreaterThan(0);
  });

  it("Skills: role-keyword coverage above the D-044 full-credit target is a strength, below is a gap", () => {
    const doc = makeDoc({ skills: [{ name: "Tech", keywords: ["Python", "SQL", "Docker"] }] });
    const impact = analyzeImpact(doc);
    const highCoverage = analyzeFindability(doc, {
      keywords: [{ term: "python" }, { term: "sql" }],
    });
    const high = scoreResume({
      doc,
      impact,
      findability: highCoverage,
      fidelityScore: 100,
      findings: [...impact.findings, ...highCoverage.findings],
      context: { stage: "student", role: "swe-intern" },
    });
    const highSkills = high.readouts.find((r) => r.section === "skills");
    expect(highSkills?.strengths.some((t) => /keyword/i.test(t))).toBe(true);

    const lowCoverage = analyzeFindability(doc, {
      keywords: [
        { term: "python" },
        { term: "sql" },
        { term: "docker" },
        { term: "kubernetes" },
        { term: "graphql" },
        { term: "rust" },
      ],
    });
    const low = scoreResume({
      doc,
      impact,
      findability: lowCoverage,
      fidelityScore: 100,
      findings: [...impact.findings, ...lowCoverage.findings],
      context: { stage: "student", role: "swe-intern" },
    });
    const lowSkills = low.readouts.find((r) => r.section === "skills");
    expect(lowSkills?.gaps.some((t) => /keyword/i.test(t))).toBe(true);
  });

  it("Format: a high fidelity score is a strength; format-section findings surface as gaps", () => {
    const clean = score(strongDoc);
    expect(clean.readouts.find((r) => r.section === "format")?.strengths.length).toBeGreaterThan(0);

    const impact = analyzeImpact(strongDoc);
    const findability = analyzeFindability(strongDoc, {});
    const withFormatFinding = scoreResume({
      doc: strongDoc,
      impact,
      findability,
      fidelityScore: 60,
      findings: [
        ...impact.findings,
        ...findability.findings,
        {
          id: "fidelity-two-column",
          layer: "fidelity",
          priority: "P0",
          section: "format",
          title: "Two-column layout confuses ATS parsers",
          evidence: "detected 2 columns",
          why: "why",
          source: "fidelity:two-column",
        },
      ],
      context: { stage: "student", role: "swe-intern" },
    });
    const dirty = withFormatFinding.readouts.find((r) => r.section === "format");
    expect(dirty?.gaps.some((t) => /two-column/i.test(t))).toBe(true);
  });
});
