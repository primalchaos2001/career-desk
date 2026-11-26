import type { Finding } from "../finding.js";
import type { ResumeDoc } from "../resume.js";

/**
 * Deterministic findability analysis (D-039; subsumes O-11). Two lexical
 * signals, no LLM: (1) coverage of the merged role/industry recruiter-search
 * keywords over the résumé's searchable text, and (2) when a JD is pasted, the
 * gap between salient JD terms and the résumé. Pure and pack-agnostic — the
 * caller (pipeline) resolves `keywords` from the active packs and passes them
 * in, so core keeps no dependency on the rules package. Semantic matching is
 * deferred to Phase B (in-browser embeddings).
 */

/** A recruiter-search term with optional surface variants (from pack YAML). */
export interface SearchKeyword {
  term: string;
  aliases?: string[];
}

export interface FindabilityOptions {
  keywords?: SearchKeyword[];
  jobDescription?: string;
}

export interface FindabilitySignals {
  /** whether a role/industry keyword list was supplied at all — NOT derivable
   * from keywordCoverage, since perfect coverage of a real list and "no list
   * provided" both read as coverage=1/missingKeywords=[] (D-042). */
  hasRoleKeywords: boolean;
  /** fraction of provided keywords present in the résumé (1 when none provided) */
  keywordCoverage: number;
  missingKeywords: string[];
  /** JD-term coverage 0–1, only when a JD is provided */
  jdCoverage?: number;
  missingJdTerms?: string[];
  hasEmail: boolean;
  hasGithub: boolean;
  hasLinkedin: boolean;
  hasPortfolio: boolean;
}

export interface FindabilityResult {
  findings: Finding[];
  signals: FindabilitySignals;
}

/** Below this coverage, the résumé gets a keyword-gap finding (D-039). */
const KEYWORD_COVERAGE_FLOOR = 0.6;
/**
 * Below this, the gap is a real visibility problem (P1); above it, missing
 * keywords are an opportunity, not a defect (P2) — nobody evidences every
 * term on a role's list (D-044).
 */
const KEYWORD_SEVERE_FLOOR = 0.25;
/** Cap on how many JD terms we treat as salient / list back. */
const MAX_JD_TERMS = 12;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "our",
  "are",
  "will",
  "have",
  "has",
  "this",
  "that",
  "from",
  "into",
  "plus",
  "who",
  "all",
  "can",
  "get",
  "was",
  "were",
  "they",
  "their",
  "them",
  "but",
  "not",
  "any",
  "job",
  "role",
  "team",
  "work",
  "working",
  "experience",
  "strong",
  "need",
  "needs",
  "want",
  "looking",
  "must",
  "should",
  "able",
  "using",
  "used",
  "use",
  "including",
  "such",
  "well",
  "across",
  "years",
  "year",
  "new",
  "help",
  "build",
  "building",
  "make",
  "making",
]);

function searchableText(doc: ResumeDoc): string {
  const parts = [
    doc.basics.summary ?? "",
    ...doc.skills.flatMap((s) => [s.name, ...s.keywords]),
    ...doc.work.flatMap((w) => [w.position ?? "", ...w.highlights]),
    ...doc.projects.flatMap((p) => [p.name, p.description ?? "", ...p.highlights, ...p.keywords]),
  ];
  return parts.join(" \n ").toLowerCase();
}

function covers(text: string, kw: SearchKeyword): boolean {
  const needles = [kw.term, ...(kw.aliases ?? [])].map((s) => s.toLowerCase());
  return needles.some((n) => n.length > 0 && text.includes(n));
}

function salientJdTerms(jd: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of jd.toLowerCase().split(/[^a-z0-9+#./-]+/)) {
    const t = raw.replace(/^[-.]+|[-.]+$/g, "");
    if (t.length < 3 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_JD_TERMS)
    .map(([t]) => t);
}

export function analyzeFindability(
  doc: ResumeDoc,
  opts: FindabilityOptions = {},
): FindabilityResult {
  const text = searchableText(doc);
  const findings: Finding[] = [];

  const keywords = opts.keywords ?? [];
  const missingKeywords = keywords.filter((k) => !covers(text, k)).map((k) => k.term);
  const keywordCoverage =
    keywords.length === 0 ? 1 : (keywords.length - missingKeywords.length) / keywords.length;

  if (keywords.length > 0 && keywordCoverage < KEYWORD_COVERAGE_FLOOR) {
    const severe = keywordCoverage < KEYWORD_SEVERE_FLOOR;
    findings.push({
      id: "findability-keyword-coverage",
      layer: "findability",
      priority: severe ? "P1" : "P2",
      section: "skills",
      title: severe
        ? "Recruiters searching for this role won't find you"
        : "Keywords that would boost your visibility",
      evidence: `not found: ${missingKeywords.slice(0, 8).join(", ")}`,
      why: "Recruiters filter candidate lists by keyword. You don't need every term — each one you can honestly evidence is a plus; with almost none, you won't surface in searches at all.",
      source: "findability:keyword-coverage",
    });
  }

  const profiles = doc.basics.profiles.map((p) => p.network.toLowerCase());
  const signals: FindabilitySignals = {
    hasRoleKeywords: keywords.length > 0,
    keywordCoverage,
    missingKeywords,
    hasEmail: doc.basics.email !== undefined,
    hasGithub: profiles.includes("github") || doc.projects.some((p) => p.githubUrl !== undefined),
    hasLinkedin: profiles.includes("linkedin"),
    hasPortfolio:
      doc.basics.url !== undefined || profiles.some((n) => n !== "github" && n !== "linkedin"),
  };

  if (opts.jobDescription && opts.jobDescription.trim().length > 0) {
    const terms = salientJdTerms(opts.jobDescription);
    const missing = terms.filter((t) => !text.includes(t));
    signals.jdCoverage = terms.length === 0 ? 1 : (terms.length - missing.length) / terms.length;
    signals.missingJdTerms = missing;
    if (missing.length > 0) {
      findings.push({
        id: "findability-jd-gap",
        layer: "findability",
        priority: "P1",
        section: "skills",
        title: "Résumé misses keywords from the job description",
        evidence: `JD terms not on your résumé: ${missing.slice(0, 8).join(", ")}`,
        why: "Recruiter search inside the ATS is keyword-driven. If the JD's exact terms don't appear (and you have the experience), you won't rank.",
        source: "jd:keyword-gap",
      });
    }
  }

  return { findings, signals };
}
