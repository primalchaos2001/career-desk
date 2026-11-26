import type { Finding, ResumeSection, SectionReadout, SectionScores } from "../finding.js";
import type { ResumeDoc } from "../resume.js";
import type { FindabilityResult } from "./findability.js";
import type { ImpactResult, SectionImpactSignals } from "./impact.js";
import { QUANTIFIED_RATIO_FLOOR } from "./impact.js";

/**
 * The section scorer (D-039): turns analyzer signals + findings into per-section
 * sub-scores and a context-weighted overall. "Earn + penalize" — each section
 * earns from normalized quality signals and loses priority-weighted points for
 * its findings (never a fake "ATS %"). Weights vary by stage/role. Pure; the
 * calibration is guarded by the golden score-bands (eval), so tune there.
 */

export interface ScoreInput {
  doc: ResumeDoc;
  impact: ImpactResult;
  findability: FindabilityResult;
  /** document-wide parse score → the Format section (undefined for .tex/docx) */
  fidelityScore?: number;
  /** all merged findings incl. rule-pack/context ones, for section deductions */
  findings: Finding[];
  context: { stage?: string; role?: string };
}

export interface ScoreResult {
  overall: number;
  sections: SectionScores;
  /** per-section strengths/gaps/benchmark, one per key in `sections` (D-042) */
  readouts: SectionReadout[];
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Priority → points removed from a section's earned score. */
const PENALTY = { P0: 25, P1: 12, P2: 5 } as const;

/** Coverage of the role keyword list that earns full Skills credit (D-044). */
const KEYWORD_FULL_CREDIT = 0.7;
/**
 * Skill-keyword breadth (generic scoring, no role list) that earns full
 * credit — the exact point `40 + 12*count` already saturates at 100 (D-042:
 * reuse the scorer's own saturation point rather than invent a second number).
 */
const SKILLS_BREADTH_FULL_CREDIT = 5;
/** Fraction of bullets leading with a strong verb that reads as a strength (D-042). */
const STRONG_VERB_RATIO_TARGET = 0.6;

/**
 * Sources whose signal is already baked into a section's *earned* score, so
 * they must NOT also be deducted (no double counting).
 */
const EARNED_SOURCES = new Set(["impact:quantification-density", "findability:keyword-coverage"]);
const isEarnedRule = (source: string): boolean =>
  /#[\w-]*(gpa|coursework)/.test(source) || EARNED_SOURCES.has(source);

/** Base per-stage section weights (renormalized over the sections present). */
type Weights = Record<ResumeSection, number>;
const STUDENT: Weights = {
  projects: 24,
  experience: 18,
  format: 18,
  skills: 16,
  education: 16,
  contact: 8,
};
const NEW_GRAD: Weights = {
  experience: 34,
  format: 22,
  projects: 14,
  skills: 14,
  education: 8,
  contact: 8,
};
/**
 * MBA applicant (D-043, corrected 2026-07-12): keyed off *role*
 * (`mba-applicant`), not stage — MBA is a target-audience/credential choice
 * orthogonal to career stage (a student or a 2-years-experienced engineer can
 * both be applying with an MBA framing), not a stage itself. The SWE/
 * engineering weight model over-rewards side projects and under-rewards
 * leadership/impact scope an MBA admissions committee actually looks for:
 * Experience carries most of the weight (career progression + quantified
 * business impact); Projects drops sharply. This REPLACES the stage base
 * entirely rather than nudging it, since it's a wholesale different profile,
 * not a small adjustment.
 */
const MBA: Weights = {
  experience: 40,
  format: 16,
  education: 15,
  skills: 15,
  projects: 6,
  contact: 8,
};

/** Small role nudges on top of the stage profile (additive, then renormalized). */
function weightsFor(context: { stage?: string; role?: string }): Weights {
  const role = context.role ?? "";
  if (role === "mba-applicant") return { ...MBA };
  const base = { ...(context.stage === "new-grad" ? NEW_GRAD : STUDENT) };
  if (role.includes("ib") || role.includes("finance")) base.education += 8;
  if (role.includes("data") || role.includes("analyst")) base.skills += 8;
  return base;
}

/**
 * The résumé section a finding is about: its explicit `section` when set, else
 * inferred from the source (D-039). Exported so the pipeline can stamp every
 * finding — including rule-pack/LLM ones — for consistent grouping in the UI.
 */
export function sectionForFinding(f: Finding): ResumeSection {
  if (f.section) return f.section;
  const s = f.source;
  if (s.startsWith("fidelity:")) return "format";
  const rule = s.split("#")[1] ?? s;
  if (/photo|personal|declaration|page|spelling/.test(rule)) return "format";
  if (/gpa|coursework|academic|education/.test(rule)) return "education";
  if (/project|github/.test(rule)) return "projects";
  if (/work|experience|quantif/.test(rule)) return "experience";
  if (/skill|keyword|cert|leadership/.test(rule)) return "skills";
  return "format";
}

/** A section's findings, worst-priority first — the raw material for `penalties` and gap text. */
function findingsFor(section: ResumeSection, findings: Finding[]): Finding[] {
  const order: Record<Finding["priority"], number> = { P0: 0, P1: 1, P2: 2 };
  return findings
    .filter((f) => sectionForFinding(f) === section && !isEarnedRule(f.source))
    .sort((a, b) => order[a.priority] - order[b.priority]);
}

/** Priority-weighted deductions for a section, skipping earned-overlap sources. */
function penalties(section: ResumeSection, findings: Finding[]): number {
  return findingsFor(section, findings).reduce((sum, f) => sum + PENALTY[f.priority], 0);
}

/** Up to 3 existing finding titles for a section — gaps never invent new copy (D-042). */
function gapsFromFindings(section: ResumeSection, findings: Finding[]): string[] {
  return findingsFor(section, findings)
    .slice(0, 3)
    .map((f) => f.title);
}

/** One-line description of a strong version of each section (D-042; generic for v1 — not yet role-specific). */
const BENCHMARK: Record<ResumeSection, string> = {
  format:
    "No parsing red flags: single-column layout, no photo/personal details where the region doesn't expect them, one page for students.",
  experience:
    "Most bullets quantify outcomes (%, $, time, scale) and lead with a specific action verb, not a duty description.",
  projects:
    "At least one or two projects with quantified impact, each with a link to code or a demo.",
  skills:
    "Covers most of the target role's recruiter-search keywords, evidenced elsewhere on the résumé.",
  education: "Shows degree, GPA/score, and a line of relevant coursework.",
  contact: "Email plus GitHub and/or LinkedIn are all linked and easy to click.",
};

const bulletQuality = (sig: SectionImpactSignals): number =>
  55 + 30 * sig.quantifiedRatio + 15 * sig.strongVerbRatio;

/**
 * Bullet-quality strengths/gaps shared by Experience and Projects (D-042).
 * Quantification is derived directly from the signal, not from
 * `gapsFromFindings` — its rule-pack/impact findings are the *earned* sources
 * `isEarnedRule` excludes from gaps (no double-counting the deduction), which
 * would otherwise leave a below-floor section with no stated reason at all.
 */
function bulletReadout(
  section: "experience" | "projects",
  sig: SectionImpactSignals | undefined,
  findings: Finding[],
): Pick<SectionReadout, "strengths" | "gaps"> {
  const strengths: string[] = [];
  const gaps: string[] = [];
  if (sig && sig.bulletCount > 0) {
    const n = Math.round(sig.quantifiedRatio * sig.bulletCount);
    if (sig.quantifiedRatio >= QUANTIFIED_RATIO_FLOOR) {
      strengths.push(`${n} of ${sig.bulletCount} bullets quantify impact with a number or metric.`);
    } else {
      gaps.push(
        `Only ${n} of ${sig.bulletCount} bullets quantify impact — add a number, %, or scale.`,
      );
    }
    if (sig.weakVerbCount === 0 && sig.strongVerbRatio >= STRONG_VERB_RATIO_TARGET) {
      strengths.push("Bullets consistently lead with a specific action verb.");
    }
  }
  // Drop other quantification-titled findings here — the signal-derived gap
  // above already says it, with the actual bullet count (not a second,
  // vaguer restatement of the same complaint).
  const rest = gapsFromFindings(section, findings).filter((t) => !/quantif/i.test(t));
  return { strengths, gaps: [...gaps, ...rest] };
}

export function scoreResume(input: ScoreInput): ScoreResult {
  const { doc, impact, findability, fidelityScore, findings, context } = input;
  const sig = findability.signals;
  const sections: Partial<Record<ResumeSection, number>> = {};
  const readouts: SectionReadout[] = [];
  const addReadout = (
    section: ResumeSection,
    score: number,
    parts: Pick<SectionReadout, "strengths" | "gaps">,
  ): void => {
    readouts.push({ section, score, benchmark: BENCHMARK[section], ...parts });
  };

  // Format — always present; the document-wide parse dimension.
  const formatScore = clamp((fidelityScore ?? 100) - penalties("format", findings));
  sections.format = formatScore;
  addReadout("format", formatScore, {
    strengths: formatScore >= 90 ? ["Parses cleanly — no formatting red flags."] : [],
    gaps: gapsFromFindings("format", findings),
  });

  // Experience — only when there are work bullets.
  const exp = impact.sections.experience;
  if (doc.work.length > 0 || exp) {
    const earned = exp ? bulletQuality(exp) : 40;
    const expScore = clamp(earned - penalties("experience", findings));
    sections.experience = expScore;
    addReadout("experience", expScore, bulletReadout("experience", exp, findings));
  }

  // Projects — a real section for students; absence is itself a gap.
  const proj = impact.sections.projects;
  if (doc.projects.length > 0) {
    const earned = proj ? bulletQuality(proj) : 60;
    const projScore = clamp(earned - penalties("projects", findings));
    sections.projects = projScore;
    addReadout("projects", projScore, bulletReadout("projects", proj, findings));
  } else {
    const projScore = clamp(40 - penalties("projects", findings));
    sections.projects = projScore;
    addReadout("projects", projScore, {
      strengths: [],
      gaps: [
        "No projects listed — with little work history, projects are the main evidence of ability.",
        ...gapsFromFindings("projects", findings),
      ],
    });
  }

  // Skills — keyword coverage when role keywords exist, else skill breadth.
  // Coverage credit saturates at KEYWORD_FULL_CREDIT: role keyword lists are a
  // superset nobody fully evidences, so hitting ~70% of them IS full marks —
  // keywords are a plus, not a checklist (D-044).
  const skillKeywordCount = doc.skills.reduce((n, s) => n + s.keywords.length, 0);
  const skillsEarned = sig.hasRoleKeywords
    ? 50 + 50 * Math.min(1, sig.keywordCoverage / KEYWORD_FULL_CREDIT)
    : Math.min(100, 40 + 12 * skillKeywordCount);
  const skillsScore = clamp(skillsEarned - penalties("skills", findings));
  sections.skills = skillsScore;
  {
    const strengths: string[] = [];
    const gaps: string[] = [];
    if (sig.hasRoleKeywords) {
      const pct = Math.round(sig.keywordCoverage * 100);
      if (sig.keywordCoverage >= KEYWORD_FULL_CREDIT) {
        strengths.push(`Covers ${pct}% of the role's recruiter-search keywords.`);
      } else if (sig.missingKeywords.length > 0) {
        gaps.push(
          `Keywords that would add visibility: ${sig.missingKeywords.slice(0, 5).join(", ")}.`,
        );
      }
    } else if (skillKeywordCount >= SKILLS_BREADTH_FULL_CREDIT) {
      strengths.push(
        `Lists ${skillKeywordCount} distinct skill keywords across your skill groups.`,
      );
    } else if (skillKeywordCount > 0) {
      gaps.push(
        `Only ${skillKeywordCount} skill keyword(s) listed — add more you can honestly evidence.`,
      );
    }
    addReadout("skills", skillsScore, {
      strengths,
      gaps: [...gaps, ...gapsFromFindings("skills", findings)],
    });
  }

  // Education — presence of degree + GPA + coursework.
  if (doc.education.length > 0) {
    const hasGpa = doc.education.some((e) => e.gpa !== undefined || e.score !== undefined);
    const hasCoursework = doc.education.some(
      (e) => e.coursework.length > 0 || e.courses.length > 0,
    );
    const earned = 50 + (hasGpa ? 25 : 0) + (hasCoursework ? 25 : 0);
    const eduScore = clamp(earned - penalties("education", findings));
    sections.education = eduScore;
    const strengths: string[] = [];
    if (hasGpa && hasCoursework) strengths.push("Lists both GPA/score and relevant coursework.");
    else if (hasGpa) strengths.push("Lists a GPA/score.");
    else if (hasCoursework) strengths.push("Lists relevant coursework.");
    const gaps: string[] = [];
    if (!hasGpa) gaps.push("No GPA or score listed.");
    if (!hasCoursework) gaps.push("No relevant coursework listed.");
    addReadout("education", eduScore, {
      strengths,
      gaps: [...gaps, ...gapsFromFindings("education", findings)],
    });
  }

  // Contact & links.
  const contactEarned =
    (sig.hasEmail ? 35 : 0) +
    (sig.hasGithub ? 30 : 0) +
    (sig.hasLinkedin ? 25 : 0) +
    (sig.hasPortfolio ? 10 : 0);
  const contactScore = clamp(contactEarned - penalties("contact", findings));
  sections.contact = contactScore;
  {
    const present = [
      sig.hasEmail && "email",
      sig.hasGithub && "GitHub",
      sig.hasLinkedin && "LinkedIn",
      sig.hasPortfolio && "a portfolio link",
    ].filter((x): x is string => Boolean(x));
    const missing = [
      !sig.hasEmail && "email",
      !sig.hasGithub && "GitHub",
      !sig.hasLinkedin && "LinkedIn",
    ].filter((x): x is string => Boolean(x));
    addReadout("contact", contactScore, {
      strengths: present.length > 0 ? [`${present.join(", ")} linked.`] : [],
      gaps: [
        ...(missing.length > 0 ? [`Not linked: ${missing.join(", ")}.`] : []),
        ...gapsFromFindings("contact", findings),
      ],
    });
  }

  // Overall — weighted mean over the sections that are present.
  const weights = weightsFor(context);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [section, value] of Object.entries(sections) as [ResumeSection, number][]) {
    const w = weights[section];
    weightedSum += value * w;
    weightTotal += w;
  }
  const overall = weightTotal === 0 ? 0 : clamp(weightedSum / weightTotal);

  return { overall, sections, readouts };
}
