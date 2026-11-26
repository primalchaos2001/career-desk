import type { ContextUsed } from "./report";

/**
 * C1/C3 issue composers (docs/IMPROVEMENT-LOOP.md): the user's own GitHub
 * account is the transport, so these just build a URL — GitHub's issue-form
 * query-param prefill (?template=x.yml&FIELD_ID=value) fills the template,
 * nothing is sent until the user reviews and submits it themselves.
 */

export const REPO = "primalchaos2001/career-desk";

export type FeedbackVerdict = "up" | "down" | "na";

const VERDICT_LABEL: Record<FeedbackVerdict, string> = {
  up: "👍",
  down: "👎",
  na: "not applicable",
};

export interface VerdictEntry {
  id: string;
  verdict: FeedbackVerdict;
  reason?: string;
}

function contextLine(ctx: ContextUsed): string {
  return [ctx.region, ctx.role, ctx.industry, ctx.stage].filter(Boolean).join(" / ");
}

export function buildFeedbackIssueUrl(ctx: ContextUsed, entries: VerdictEntry[]): string {
  const verdicts = entries
    .map((e) => `${e.id} ${VERDICT_LABEL[e.verdict]}${e.reason ? ` — ${e.reason}` : ""}`)
    .join("\n");
  const params = new URLSearchParams({
    template: "feedback.yml",
    context: contextLine(ctx),
    verdicts,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

export function buildMissIssueUrl(ctx: ContextUsed): string {
  const params = new URLSearchParams({ template: "miss.yml", context: contextLine(ctx) });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
