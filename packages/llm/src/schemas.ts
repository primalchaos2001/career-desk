import { Priority, ResumeDoc } from "@tailorats/core";
import { z } from "zod";

/** What the extraction prompt may return: ResumeDoc content, never meta. */
export const ExtractedResume = ResumeDoc.omit({ meta: true });
export type ExtractedResume = z.infer<typeof ExtractedResume>;

/** Review findings before code assigns ids/source (source is always "llm"). */
export const ReviewFinding = z.object({
  layer: z.enum(["findability", "impact"]),
  priority: Priority,
  title: z.string(),
  /** verbatim quote from the resume that triggered this finding */
  evidence: z.string(),
  why: z.string(),
  suggestion: z
    .object({
      before: z.string().optional(),
      after: z.string().optional(),
    })
    .optional(),
});

export const ReviewResult = z.object({
  scores: z.object({
    /** will you surface in the searches recruiters actually run (0-100) */
    findability: z.number().min(0).max(100),
    /** does it survive the human 6-second skim (0-100) */
    impact: z.number().min(0).max(100),
  }),
  findings: z.array(ReviewFinding),
});

export type ReviewFinding = z.infer<typeof ReviewFinding>;
export type ReviewResult = z.infer<typeof ReviewResult>;

/** One enrichment patch for an existing finding (D-056/O-20) — never a new finding. */
export const Enrichment = z.object({
  id: z.string(),
  why: z.string().optional(),
  suggestion: z
    .object({
      before: z.string().optional(),
      after: z.string().optional(),
    })
    .optional(),
});

export const EnrichmentResult = z.object({
  enrichments: z.array(Enrichment),
});

export type Enrichment = z.infer<typeof Enrichment>;
export type EnrichmentResult = z.infer<typeof EnrichmentResult>;
