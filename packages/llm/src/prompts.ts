import type { AnalysisContext, Finding, ResumeDoc } from "@tailorats/core";
import { sectionForFinding } from "@tailorats/core";

/**
 * Versioned prompt templates (O-04, D-007/D-024). Bump PROMPT_VERSION on any
 * wording change; prompt changes require a golden-set diff in the PR
 * (ARCHITECTURE §10).
 */
export const PROMPT_VERSION = "2026-07-07.1";

/**
 * Hard rules baked into every prompt (D-007). The never-fabricate rule is
 * the product's trust foundation — do not soften it.
 */
export const HARD_RULES = `Rules you must never break:
1. NEVER invent facts. Do not add skills, numbers, dates, employers, titles, or outcomes that are not in the provided material.
2. Rewrites may only rearrange or rephrase facts the candidate provided. If a bullet lacks a metric, say a metric is missing — do not make one up.
3. Every finding must include, in "evidence", a verbatim quote from the resume text it refers to.
4. If information is missing or unreadable, leave the field out. An empty field is correct; a guessed field is a serious error.
5. Respond with ONLY a single JSON object matching the requested shape — no prose, no markdown fences.`;

export interface ExtractionInput {
  /** raw section blocks from PDF ingest: heading + lines */
  sections: { heading: string; text: string }[];
}

export function buildExtractionPrompt(input: ExtractionInput): { system: string; user: string } {
  const system = `You extract resume content into JSON Resume format. You transcribe only what is present.

${HARD_RULES}

Output shape: a JSON object with keys basics{name,email,phone,url,summary,location,profiles[]}, work[]{name,position,location,startDate,endDate,highlights[]}, education[]{institution,area,studyType,startDate,endDate,gpa{value,scale},coursework[]}, skills[]{name,keywords[]}, projects[]{name,description,highlights[],keywords[],url,githubUrl}, awards[], certificates[], languages[].
Dates: "YYYY", "YYYY-MM" or "YYYY-MM-DD" only; omit dates you cannot normalize.
profiles[].network: use "GitHub", "LinkedIn", etc. based on the URL.`;

  const user = input.sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text))
    .join("\n\n");

  return { system, user: `Extract this resume:\n\n${user}` };
}

export interface ReviewInput {
  resume: ResumeDoc;
  context: AnalysisContext;
  /** compiled non-deterministic rule-pack instructions (ARCHITECTURE §5) */
  packInstructions?: string[];
}

export function buildReviewPrompt(input: ReviewInput): { system: string; user: string } {
  const system = `You are an honest resume reviewer for students and new graduates. You model how hiring actually works: recruiters search databases by keywords (findability) and skim resumes in seconds (impact). There is no "ATS auto-reject" — never imply there is.

${HARD_RULES}

Review dimensions:
- findability (score 0-100): would keyword searches recruiters run for this role surface this resume? Consider missing role-standard terms the candidate plausibly has evidence for (never invent evidence). Findings: layer "findability".
- impact (score 0-100): do bullets lead with actions and outcomes? Are the strongest items prominent? Findings: layer "impact".

Finding priorities: P0 = would likely cost the candidate the screen; P1 = high impact; P2 = polish.
For rewrite suggestions use suggestion.before (verbatim) and suggestion.after (rephrased using only the candidate's own facts).

Output shape: {"scores":{"findability":N,"impact":N},"findings":[{"layer":"findability"|"impact","priority":"P0"|"P1"|"P2","title":"...","evidence":"verbatim quote","why":"...","suggestion":{"before":"...","after":"..."}}]}`;

  const parts = [
    `Target context: role=${input.context.role}, region=${input.context.region}` +
      (input.context.industry ? `, industry=${input.context.industry}` : "") +
      (input.context.stage ? `, stage=${input.context.stage}` : ""),
  ];
  if (input.packInstructions?.length) {
    parts.push(
      `Additional context-specific review guidance:\n- ${input.packInstructions.join("\n- ")}`,
    );
  }
  if (input.context.jobDescription) {
    parts.push(`Job description the candidate is targeting:\n${input.context.jobDescription}`);
  }
  parts.push(`Resume (JSON):\n${JSON.stringify(input.resume, null, 2)}`);

  return { system, user: parts.join("\n\n") };
}

export interface EnrichmentInput {
  resume: ResumeDoc;
  context: AnalysisContext;
  /** deterministic findings already computed — enrich these, never add new ones (D-056/O-20) */
  findings: Finding[];
}

/**
 * On-device review's prompt (D-056/O-20): unlike buildReviewPrompt, this
 * asks the model to enrich findings the deterministic engine already
 * produced rather than independently re-review the résumé — a narrower,
 * more grounded task that better fits a small local model and keeps the
 * deterministic scores authoritative (D-039 stays the single source of
 * truth for scoring; this only touches `why`/`suggestion` text).
 */
// A real résumé can carry many findings and a long history — both are
// unbounded inputs otherwise, and a long WASM prefill is exactly what caused
// a real out-of-memory browser crash (D-059). Highest-priority findings are
// the ones worth enriching first anyway, so capping is a quality-neutral cut.
export const MAX_ENRICHMENT_FINDINGS = 8;
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 } as const;

export function buildEnrichmentPrompt(input: EnrichmentInput): { system: string; user: string } {
  const system = `You enrich an already-computed résumé review — you do not perform a new review and you do not invent findings. You are given a fixed list of findings (each with an id, evidence, and a short deterministic "why"); for findings where you can add real value, provide a richer "why" (still grounded in the same evidence) and/or a concrete before/after rewrite using only the candidate's own facts.

${HARD_RULES}

Rules specific to this task:
- Only reference "id" values from the findings list you are given. Never invent a new finding or a new id.
- Skip any finding you have nothing useful to add to — an empty result for it is correct; do not force an enrichment.
- "suggestion.before" must be a verbatim excerpt already in the résumé; "suggestion.after" may only rephrase or reorganize facts already present.
- Some findings' evidence quotes more than one bullet (look for multiple quoted excerpts separated by ";"). Pick only the single most relevant one as "suggestion.before" — never quote more than one bullet per enrichment.
- Keep descriptions ("why") and suggestions ("suggestion.after") extremely concise (one short sentence maximum each). Focus only on direct, high-impact corrections.

Output shape: {"enrichments":[{"id":"...","why":"...","suggestion":{"before":"...","after":"..."}}]}`;

  const cappedFindings = [...input.findings]
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .slice(0, MAX_ENRICHMENT_FINDINGS);

  // Context Triage: reduce prefill size by pruning sections that have no findings to enrich.
  // We always keep 'basics'.
  const neededSections = new Set<string>(["basics"]);
  for (const f of cappedFindings) {
    const sec = sectionForFinding(f);
    if (sec === "experience") {
      neededSections.add("work");
    } else if (sec === "projects") {
      neededSections.add("projects");
    } else if (sec === "skills") {
      neededSections.add("skills");
      neededSections.add("certificates");
    } else if (sec === "education") {
      neededSections.add("education");
      neededSections.add("awards");
    }
  }

  // Prune the resume object
  const prunedResume: Partial<ResumeDoc> = {
    basics: input.resume.basics,
  };
  if (neededSections.has("work") && input.resume.work) {
    prunedResume.work = input.resume.work;
  }
  if (neededSections.has("projects") && input.resume.projects) {
    prunedResume.projects = input.resume.projects;
  }
  if (neededSections.has("skills") && input.resume.skills) {
    prunedResume.skills = input.resume.skills;
  }
  if (neededSections.has("certificates") && input.resume.certificates) {
    prunedResume.certificates = input.resume.certificates;
  }
  if (neededSections.has("education") && input.resume.education) {
    prunedResume.education = input.resume.education;
  }
  if (neededSections.has("awards") && input.resume.awards) {
    prunedResume.awards = input.resume.awards;
  }
  if (input.resume.languages) {
    prunedResume.languages = input.resume.languages;
  }

  const parts = [
    `Target context: role=${input.context.role}, region=${input.context.region}` +
      (input.context.industry ? `, industry=${input.context.industry}` : "") +
      (input.context.stage ? `, stage=${input.context.stage}` : ""),
    `Findings to enrich (JSON):\n${JSON.stringify(
      cappedFindings.map((f) => ({ id: f.id, title: f.title, evidence: f.evidence, why: f.why })),
    )}`,
    `Resume (JSON):\n${JSON.stringify(prunedResume)}`,
  ];

  return { system, user: parts.join("\n\n") };
}
