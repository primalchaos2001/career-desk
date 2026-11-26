import type { Finding, ResumeSection } from "../finding.js";
import type { ResumeDoc } from "../resume.js";
import { FILLER_PHRASES, STRONG_VERBS, WEAK_LEAD_WORDS, WEAK_OPENERS } from "./lexicons.js";

/**
 * Deterministic impact analysis (D-039): quantification density, weak/strong
 * lead verbs, filler/clichés, and over-long bullets over the résumé's Experience
 * (work) and Projects highlights. Pure — no LLM, browser + Node. Emits
 * section-tagged impact-layer findings AND normalized per-section signals the
 * scorer consumes. Thresholds documented in D-039.
 */

/** A bullet is "too long" past this many words (a skimmable bullet is one line). */
const LONG_BULLET_WORDS = 40;
/** Below this quantified-bullet ratio, the section gets a quantification finding. */
export const QUANTIFIED_RATIO_FLOOR = 0.5;

export interface SectionImpactSignals {
  bulletCount: number;
  /** fraction of bullets containing a number/metric (0 when no bullets) */
  quantifiedRatio: number;
  /** fraction of bullets leading with a strong action verb */
  strongVerbRatio: number;
  weakVerbCount: number;
  fillerCount: number;
  longBulletCount: number;
}

export interface ImpactResult {
  findings: Finding[];
  sections: Partial<
    Record<Extract<ResumeSection, "experience" | "projects">, SectionImpactSignals>
  >;
}

const leadWord = (bullet: string): string =>
  bullet
    .trim()
    .replace(/^[\s•\-*·▪‣]+/, "")
    .split(/\s+/, 1)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "") ?? "";

const isQuantified = (bullet: string): boolean => /\d/.test(bullet);
const isStrongLead = (bullet: string): boolean => STRONG_VERBS.has(leadWord(bullet));
const isWeakLead = (bullet: string): boolean => {
  const lower = bullet
    .trim()
    .toLowerCase()
    .replace(/^[\s•\-*·▪‣]+/, "");
  return WEAK_OPENERS.some((p) => lower.startsWith(p)) || WEAK_LEAD_WORDS.has(leadWord(bullet));
};
const fillerHits = (bullet: string): string[] => {
  const lower = bullet.toLowerCase();
  return FILLER_PHRASES.filter((p) => lower.includes(p));
};
const wordCount = (bullet: string): number => bullet.trim().split(/\s+/).filter(Boolean).length;

function signalsFor(bullets: string[]): SectionImpactSignals {
  const n = bullets.length;
  const quantified = bullets.filter(isQuantified).length;
  const strong = bullets.filter(isStrongLead).length;
  return {
    bulletCount: n,
    quantifiedRatio: n === 0 ? 0 : quantified / n,
    strongVerbRatio: n === 0 ? 0 : strong / n,
    weakVerbCount: bullets.filter(isWeakLead).length,
    fillerCount: bullets.filter((b) => fillerHits(b).length > 0).length,
    longBulletCount: bullets.filter((b) => wordCount(b) > LONG_BULLET_WORDS).length,
  };
}

const preview = (items: string[], max = 2): string =>
  items
    .slice(0, max)
    .map((s) => `"${s.length > 80 ? `${s.slice(0, 77)}…` : s}"`)
    .join("; ");

function findingsForSection(section: "experience" | "projects", bullets: string[]): Finding[] {
  const out: Finding[] = [];
  if (bullets.length === 0) return out;
  const s = signalsFor(bullets);
  const where = section === "experience" ? "Experience" : "Projects";

  if (bullets.length >= 2 && s.quantifiedRatio < QUANTIFIED_RATIO_FLOOR) {
    const quantified = Math.round(s.quantifiedRatio * bullets.length);
    const unquantified = bullets.filter((b) => !isQuantified(b));
    out.push({
      id: `impact-quantification-${section}`,
      layer: "impact",
      priority: "P1",
      section,
      title: `${where} bullets rarely quantify outcomes`,
      // A quoted example (not just the count) so AI enrichment (D-056/O-20)
      // has a real bullet to rewrite instead of restating the stat (D-064).
      evidence: `${quantified} of ${bullets.length} bullets contain a number or metric, e.g. ${preview(unquantified)}`,
      why: "Recruiters skim for numbers — a metric turns a claim into evidence. Add scope, %, $, time saved, or scale where you can honestly measure it.",
      source: "impact:quantification-density",
    });
  }

  const weakBullets = bullets.filter(isWeakLead);
  if (weakBullets.length > 0) {
    out.push({
      id: `impact-weak-verbs-${section}`,
      layer: "impact",
      priority: "P1",
      section,
      title: `Weak or passive lead verbs in ${where}`,
      evidence: `${weakBullets.length} bullet(s), e.g. ${preview(weakBullets)}`,
      why: "Openers like “Responsible for” or “Worked on” hide ownership. Lead with the action you drove (Built, Cut, Shipped, Automated).",
      source: "impact:weak-verbs",
    });
  }

  const fillerBullets = bullets.filter((b) => fillerHits(b).length > 0);
  if (fillerBullets.length > 0) {
    const phrases = [...new Set(fillerBullets.flatMap(fillerHits))];
    out.push({
      id: `impact-filler-${section}`,
      layer: "impact",
      priority: "P2",
      section,
      title: `Filler / clichés in ${where}`,
      evidence: `found: ${preview(phrases, 3)}`,
      why: "Clichés like “team player” or “references available on request” burn space a specific accomplishment could use. Cut them.",
      source: "impact:filler",
    });
  }

  if (s.longBulletCount > 0) {
    const longBullets = bullets.filter((b) => wordCount(b) > LONG_BULLET_WORDS);
    out.push({
      id: `impact-bullet-length-${section}`,
      layer: "impact",
      priority: "P2",
      section,
      title: `Over-long bullets in ${where}`,
      evidence: `${s.longBulletCount} bullet(s) exceed ${LONG_BULLET_WORDS} words, e.g. ${preview(longBullets)}`,
      why: "A bullet a recruiter can absorb in one glance is one line. Split or tighten anything that runs long.",
      source: "impact:bullet-length",
    });
  }

  return out;
}

export function analyzeImpact(doc: ResumeDoc): ImpactResult {
  const experience = doc.work.flatMap((w) => w.highlights);
  const projects = doc.projects.flatMap((p) => p.highlights);

  const findings = [
    ...findingsForSection("experience", experience),
    ...findingsForSection("projects", projects),
  ];

  const sections: ImpactResult["sections"] = {};
  if (experience.length > 0) sections.experience = signalsFor(experience);
  if (projects.length > 0) sections.projects = signalsFor(projects);

  return { findings, sections };
}
