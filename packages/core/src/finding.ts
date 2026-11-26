import { z } from "zod";

/**
 * Finding & report format (docs/ARCHITECTURE.md §4).
 * Three honest scores — never a fake "ATS pass %" (ADR D-002).
 */

export const Layer = z.enum(["fidelity", "findability", "impact", "context"]);

/** P0 blocker · P1 high-impact · P2 polish */
export const Priority = z.enum(["P0", "P1", "P2"]);

/** Context-anchored .tex edit (anchors, not line numbers — robust to user edits). */
export const TexPatch = z.object({
  anchor: z.string(),
  old: z.string(),
  new: z.string(),
});

export const Suggestion = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  texPatch: TexPatch.optional(),
});

/**
 * `source` provenance forms:
 *   "rulepack:<pack>#<ruleId>" — deterministic rule (auditable, cited)
 *   "fidelity:<check>"        — deterministic parse-fidelity heuristic
 *   "jd:<locator>"            — derived from the pasted job description
 *   "llm"                     — LLM content review
 */
export const FindingSource = z
  .string()
  .regex(
    /^(rulepack:[\w\-/.]+#[\w-]+|fidelity:[\w-]+|impact:[\w-]+|findability:[\w-]+|jd:.+|llm)$/,
    "invalid finding source",
  );

/**
 * The resume section a finding is *about* — the "where" (D-039), orthogonal to
 * `layer` (the "why"). "format" is the document-wide parse/fidelity dimension,
 * not a literal résumé section. Student-centric set: no work history means
 * projects/links carry the résumé.
 */
export const ResumeSection = z.enum([
  "contact",
  "experience",
  "projects",
  "skills",
  "education",
  "format",
]);

export const Finding = z.object({
  id: z.string(),
  layer: Layer,
  priority: Priority,
  title: z.string(),
  evidence: z.string(),
  why: z.string(),
  source: FindingSource,
  suggestion: Suggestion.optional(),
  /** which résumé section this is about; drives the per-section sub-scores (D-039) */
  section: ResumeSection.optional(),
  /**
   * True when on-device AI enriched this deterministic finding's `why`/
   * `suggestion` (D-056/O-20) — distinct from `source: "llm"`, which is for
   * findings an LLM originated independently (hosted-provider review path,
   * unchanged). Enrichment never changes `source`: the rule citation stays
   * visible even after AI has richened the explanation.
   */
  enriched: z.boolean().optional(),
});

export const Scores = z.object({
  fidelity: z.number().min(0).max(100),
  findability: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
});

/** Per-section sub-scores 0–100, keyed by ResumeSection; any subset (D-039). */
export const SectionScores = z.partialRecord(ResumeSection, z.number().min(0).max(100));

/**
 * Per-section "what's good / what's weak vs the bar" readout (D-042). Short,
 * evidence-bearing strings — a read, not another deduction list. `strengths`
 * and `gaps` are drawn from the same signals/thresholds that produced `score`
 * (single source of truth: the readout never claims something the score
 * didn't already credit or penalize). `benchmark` is a one-line description of
 * what a strong version of this section looks like.
 */
export const SectionReadout = z.object({
  section: ResumeSection,
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  benchmark: z.string(),
});

export const AnalysisContext = z.object({
  region: z.string(),
  role: z.string(),
  industry: z.string().optional(),
  stage: z.string().optional(),
  jobDescription: z.string().optional(),
});

export const Report = z.object({
  scores: Scores.partial(),
  /** context-weighted composite of the section sub-scores 0–100 (D-039) */
  overall: z.number().min(0).max(100).optional(),
  /** per-section sub-scores (D-039) */
  sections: SectionScores.optional(),
  /** per-section strengths/gaps/benchmark reads, one per scored section (D-042) */
  readouts: z.array(SectionReadout).optional(),
  findings: z.array(Finding),
  contextUsed: AnalysisContext,
  /** true when no LLM provider was configured — deterministic layers only */
  degraded: z.boolean().default(false),
});

export type Layer = z.infer<typeof Layer>;
export type Priority = z.infer<typeof Priority>;
export type TexPatch = z.infer<typeof TexPatch>;
export type Suggestion = z.infer<typeof Suggestion>;
export type ResumeSection = z.infer<typeof ResumeSection>;
export type Finding = z.infer<typeof Finding>;
export type Scores = z.infer<typeof Scores>;
export type SectionScores = z.infer<typeof SectionScores>;
export type SectionReadout = z.infer<typeof SectionReadout>;
export type AnalysisContext = z.infer<typeof AnalysisContext>;
export type Report = z.infer<typeof Report>;
