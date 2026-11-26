import { Layer, Priority } from "@tailorats/core";
import { z } from "zod";

/**
 * Rule-pack format (docs/ARCHITECTURE.md §5, ADR D-005).
 *
 * Rules are data: each names a check from the TS check registry
 * (src/checks/) plus params and messaging. Packs are YAML in rulepacks/,
 * validated against these schemas at load time. A build step compiles them to
 * JSON for the browser bundle (Phase 2); Node loads YAML directly (./node).
 *
 * Every rule must cite a source — uncited advice is not accepted (D-002:
 * trust is the brand).
 */

export const PackKind = z.enum(["region", "role", "industry", "stage"]);

export const RuleSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  layer: Layer.default("context"),
  priority: Priority,
  /** name of a registered check in src/checks/ */
  check: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  /** shown to the user as the "why" — plain language, no fear-mongering */
  why: z.string(),
  /** citation backing the rule */
  source: z.object({
    url: z.string(),
    note: z.string().optional(),
  }),
  suggestion: z
    .object({
      before: z.string().optional(),
      after: z.string().optional(),
    })
    .optional(),
});

/** Later packs in merge order can tune or disable earlier packs' rules. */
export const RuleOverride = z.object({
  disabled: z.boolean().optional(),
  priority: Priority.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Recruiter-search terms for the deterministic findability score (D-039). Role
 * and industry packs declare the keywords recruiters filter on; the pipeline
 * merges them and the core findability analyzer scores coverage. Each term is
 * cited via the pack's own sources. `aliases` are accepted surface variants.
 */
export const SearchKeyword = z.object({
  term: z.string(),
  aliases: z.array(z.string()).default([]),
});

export const RulePack = z.object({
  pack: z.string().regex(/^(region|role|industry|stage)\/[a-z0-9-]+$/),
  kind: PackKind,
  name: z.string(),
  version: z.string(),
  rules: z.array(RuleSpec).default([]),
  overrides: z.record(z.string(), RuleOverride).default({}),
  /** recruiter-search keywords for the findability score (D-039); role/industry packs */
  searchKeywords: z.array(SearchKeyword).default([]),
});

export type PackKind = z.infer<typeof PackKind>;
export type RuleSpec = z.infer<typeof RuleSpec>;
export type RuleOverride = z.infer<typeof RuleOverride>;
export type SearchKeyword = z.infer<typeof SearchKeyword>;
export type RulePack = z.infer<typeof RulePack>;

/** What a check reports back; `evidence` is quoted in the finding. */
export interface CheckResult {
  triggered: boolean;
  evidence?: string;
}

export type CheckParams = Record<string, unknown>;
