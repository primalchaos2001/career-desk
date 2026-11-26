import {
  type AnalysisContext,
  analyzeFindability,
  analyzeImpact,
  buildRegionSignals,
  checkFidelity,
  enrichGithub,
  extractPdf,
  extractResumeDoc,
  type Finding,
  type PdfWorkerConfig,
  parseTexResume,
  type Report,
  ResumeDoc,
  type Scores,
  type SectionReadout,
  type SectionScores,
  scoreResume,
  sectionForFinding,
  splitSections,
} from "@tailorats/core";
import {
  buildEnrichmentPrompt,
  buildExtractionPrompt,
  buildReviewPrompt,
  completeStructured,
  createProviders,
  EnrichmentResult,
  ExtractedResume,
  type LlmProvider,
  type ProviderConfig,
  ReviewResult,
} from "@tailorats/llm";
import { evaluate, type RulePack } from "@tailorats/rules";

/**
 * Pipeline assembly (O-06, ARCHITECTURE §1): ingest → extract → fidelity →
 * rule packs → GitHub enrichment → LLM review → merged Report.
 * Lives in its own package (not core, as the board originally said) because
 * it composes core + rules + llm — putting it in core would cycle (D-025).
 *
 * Degraded mode (no LLM provider): deterministic layers still produce
 * fidelity + context findings and the fidelity score; report.degraded=true.
 */

export type AnalyzeSource =
  | { kind: "pdf"; data: Uint8Array }
  | { kind: "tex"; source: string }
  | { kind: "resumedoc"; doc: ResumeDoc; fidelity?: { score: number; findings: Finding[] } };

export interface AnalyzeInput {
  source: AnalyzeSource;
  context: AnalysisContext;
  /** rule packs already loaded for the context (Node: rules/node loadPack; browser: compiled JSON) */
  packs: RulePack[];
  /** explicit provider (tests) or config for auto-pick; omit → degraded mode */
  llm?: { provider: LlmProvider } | { config: ProviderConfig };
  github?: { pat?: string; fetch?: typeof fetch };
  /** browsers must supply pdf.js's worker; Node may omit it (D-033) */
  pdfWorker?: PdfWorkerConfig;
}

export interface AnalyzeResult {
  report: Report;
  doc: ResumeDoc;
  /** non-fatal notes (enrichment skips, degraded-mode hints) */
  notes: string[];
}

async function resolveProvider(input: AnalyzeInput): Promise<LlmProvider | null> {
  if (!input.llm) return null;
  if ("provider" in input.llm) return input.llm.provider;
  for (const p of createProviders(input.llm.config)) {
    if (await p.available()) return p;
  }
  return null;
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const notes: string[] = [];
  const provider = await resolveProvider(input);
  let doc: ResumeDoc;
  let fidelity: { score: number; findings: Finding[] } | null = null;

  if (input.source.kind === "pdf") {
    const extract = await extractPdf(input.source.data, input.pdfWorker);
    fidelity = checkFidelity(extract);
    const sections = splitSections(extract);
    const regionSignals = buildRegionSignals(extract);

    let extracted: ExtractedResume | null = null;
    if (provider) {
      try {
        const prompt = buildExtractionPrompt({
          sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n") })),
        });
        extracted = await completeStructured(provider, prompt, ExtractedResume);
      } catch (e) {
        // D-050/D-052: a resolved provider can still fail on first real use
        // (e.g. LocalProvider's cold model load) — degrade, don't crash.
        notes.push(
          `AI extraction failed (${provider.id}): ${e instanceof Error ? e.message : String(e)}. ` +
            "Falling back to deterministic PDF parsing.",
        );
      }
    }
    if (extracted) {
      doc = ResumeDoc.parse({ ...extracted, meta: { sourceFormat: "pdf", regionSignals } });
    } else {
      // degraded: deterministic PDF extraction (D-040) — structured content
      // WITHOUT an LLM, so the per-section scoring still runs on a plain PDF.
      doc = extractResumeDoc(extract);
      if (!provider) {
        notes.push(
          "No AI key: your résumé was parsed deterministically from the PDF. Add a key in " +
            "Settings for higher-fidelity extraction and AI-written bullet rewrites.",
        );
      }
    }
  } else if (input.source.kind === "tex") {
    doc = parseTexResume(input.source.source);
  } else {
    // O-16: the app's async on-device review pass re-enters here with the
    // doc already extracted in pass 1 — no re-parse — carrying the fidelity
    // score/findings pass 1 already computed (fidelity has no source of its
    // own for a bare ResumeDoc, so it can only be supplied, never derived).
    doc = input.source.doc;
    fidelity = input.source.fidelity ?? null;
  }

  if (input.github && doc.projects.some((p) => p.githubUrl)) {
    const enriched = await enrichGithub(doc, {
      ...(input.github.pat ? { pat: input.github.pat } : {}),
      ...(input.github.fetch ? { fetch: input.github.fetch } : {}),
    });
    doc = enriched.doc;
    notes.push(...enriched.notes);
  }

  const contextFindings = evaluate(doc, input.packs);

  // Deterministic scoring engine (D-039): impact + findability analyzers over
  // the extracted doc. Skipped only when there is no content to score — the
  // degraded-PDF path produces a minimal doc (no LLM extraction), so its
  // section scores would be meaningless; the note above explains that.
  const hasContent =
    doc.work.length + doc.projects.length + doc.skills.length + doc.education.length > 0;
  const impact = analyzeImpact(doc);
  const searchKeywords = input.packs.flatMap((p) => p.searchKeywords);
  const findability = analyzeFindability(doc, {
    ...(searchKeywords.length > 0 ? { keywords: searchKeywords } : {}),
    ...(input.context.jobDescription ? { jobDescription: input.context.jobDescription } : {}),
  });

  let llmFindings: Finding[] = [];
  const llmScores: { findability?: number; impact?: number } = {};
  let llmReviewSucceeded = false;
  let enrichment: EnrichmentResult | null = null;
  if (provider) {
    try {
      if (provider.id === "local") {
        // D-056/D-057 (O-20): on-device AI enriches the deterministic
        // findings already computed instead of independently re-reviewing —
        // narrower task for a small local model, deterministic scores stay
        // authoritative (llmScores is deliberately left unset below).
        enrichment = await completeStructured(
          provider,
          {
            ...buildEnrichmentPrompt({
              resume: doc,
              context: input.context,
              findings: [
                ...(fidelity?.findings ?? []),
                ...contextFindings,
                ...(hasContent ? impact.findings : []),
                ...(hasContent ? findability.findings : []),
              ],
            }),
            // Bounds generation length too — an unbounded output is the other
            // half of the memory pressure that caused a real browser crash
            // during WASM inference (D-059). This number chased truncation
            // upward three times (1024→384→1024→1536, D-059/D-063/D-065) —
            // each time it was still eventually exceeded by some résumé with
            // enough findings, because a fixed cap was the wrong lever for a
            // failure mode that's really about response *length*, not model
            // quality. D-068 fixed the actual problem instead: a truncated
            // response now salvages every element the model finished instead
            // of being discarded whole. With that safety net in place, a
            // lower budget no longer risks a total failure on overflow — only
            // fewer enrichments — so this is lowered back to 1024 to cut real
            // generation time (the dominant cost on WASM/CPU, B-6), not
            // raised again (D-069).
            maxTokens: 1024,
          },
          EnrichmentResult,
        );
      } else {
        const review = await completeStructured(
          provider,
          buildReviewPrompt({ resume: doc, context: input.context }),
          ReviewResult,
        );
        llmScores.findability = review.scores.findability;
        llmScores.impact = review.scores.impact;
        llmFindings = review.findings.map((f, i) => ({
          id: `llm-${f.layer}-${String(i + 1).padStart(2, "0")}`,
          layer: f.layer,
          priority: f.priority,
          title: f.title,
          evidence: f.evidence,
          why: f.why,
          source: "llm" as const,
          ...(f.suggestion ? { suggestion: f.suggestion } : {}),
        }));
      }
      llmReviewSucceeded = true;
    } catch (e) {
      // D-050/D-052: degrade to the deterministic report rather than crashing.
      notes.push(
        `AI review failed (${provider.id}): ${e instanceof Error ? e.message : String(e)}. ` +
          "Showing the deterministic report only.",
      );
    }
  }

  const order = { P0: 0, P1: 1, P2: 2 } as const;
  const enrichmentById = new Map((enrichment?.enrichments ?? []).map((e) => [e.id, e]));
  const findings = [
    ...(fidelity?.findings ?? []),
    ...contextFindings,
    ...(hasContent ? impact.findings : []),
    ...(hasContent ? findability.findings : []),
    ...llmFindings,
  ]
    // Stamp a section on every finding (rule-pack/LLM ones lack it) so the
    // report can group by section consistently (D-039).
    .map((f) => (f.section ? f : { ...f, section: sectionForFinding(f) }))
    // D-057: apply enrichment patches after the full list exists, in one
    // pass — never trust an id the deterministic layer didn't produce.
    .map((f) => {
      const patch = enrichmentById.get(f.id);
      if (!patch) return f;
      const hasSuggestion = !!(patch.suggestion?.before || patch.suggestion?.after);
      // D-066: the prompt explicitly permits the model to add nothing to a
      // finding ("an empty result for it is correct") — an id-only patch
      // with no why and no suggestion is that correct no-op, not real
      // enrichment. Stamping `enriched: true` anyway showed an "AI-enriched"
      // badge on findings the model visibly didn't touch, live-reproduced
      // (badge present, why unchanged, no suggestion box at all).
      if (!patch.why && !hasSuggestion) return f;
      return {
        ...f,
        ...(patch.why ? { why: patch.why } : {}),
        ...(hasSuggestion ? { suggestion: patch.suggestion } : {}),
        enriched: true,
      };
    })
    .sort((a, b) => order[a.priority] - order[b.priority]);

  const scores: Partial<Scores> = {};
  if (fidelity) scores.fidelity = fidelity.score;

  let overall: number | undefined;
  let sections: SectionScores | undefined;
  let readouts: SectionReadout[] | undefined;
  if (hasContent) {
    const scored = scoreResume({
      doc,
      impact,
      findability,
      ...(fidelity ? { fidelityScore: fidelity.score } : {}),
      findings,
      context: {
        ...(input.context.stage ? { stage: input.context.stage } : {}),
        role: input.context.role,
      },
    });
    overall = scored.overall;
    sections = scored.sections;
    readouts = scored.readouts;
    // Layer scores are the "why" behind overall. Deterministic is what every
    // report gets (the floor); when an LLM key is present its review score wins
    // (D-039). Impact aggregates the bullet sections; findability the discovery
    // sections (skills coverage + contact/links).
    const avg = (vals: (number | undefined)[]): number | undefined => {
      const present = vals.filter((v): v is number => v !== undefined);
      return present.length
        ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
        : undefined;
    };
    const impactScore = llmScores.impact ?? avg([sections.experience, sections.projects]);
    const findabilityScore = llmScores.findability ?? avg([sections.skills, sections.contact]);
    if (impactScore !== undefined) scores.impact = impactScore;
    if (findabilityScore !== undefined) scores.findability = findabilityScore;
  } else {
    // no deterministic content (degraded PDF), but the LLM may have scored
    if (llmScores.findability !== undefined) scores.findability = llmScores.findability;
    if (llmScores.impact !== undefined) scores.impact = llmScores.impact;
  }

  return {
    report: {
      scores,
      ...(overall !== undefined ? { overall } : {}),
      ...(sections ? { sections } : {}),
      ...(readouts ? { readouts } : {}),
      findings,
      contextUsed: input.context,
      // reflects whether the LLM review actually landed, not just whether a
      // provider was resolved (D-052: a resolved provider can still fail)
      degraded: !llmReviewSucceeded,
    },
    doc,
    notes,
  };
}
