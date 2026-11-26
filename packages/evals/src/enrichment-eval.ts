import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResumeDoc } from "@tailorats/core";
import { LocalProvider, MAX_ENRICHMENT_FINDINGS } from "@tailorats/llm";
import { analyze } from "@tailorats/pipeline";
import type { RulePack } from "@tailorats/rules";
import { loadPack } from "@tailorats/rules/node";
import yaml from "js-yaml";
import { z } from "zod";

/**
 * O-18: golden-set eval for the on-device (local) provider's enrichment
 * quality. NOT in CI — real CPU inference against the shipped default model
 * (Qwen3-0.6B-ONNX, D-058), so this is slow (minutes, not seconds), same
 * reasoning as local-model-compare.ts (D-060).
 *
 * D-057 pivoted on-device review to *enrichment*: it patches why/suggestion
 * on findings the deterministic engine already produced, it never adds new
 * ones — so the board's original "score by finding-overlap" plan (written
 * for the independent-review hosted-provider path) doesn't apply here;
 * there's nothing new to overlap against. Two numbers that DO apply and are
 * fully automatic (no hand-labeled "expected enrichment" golden data needed):
 *
 *   coverage — of the findings actually offered to the model (capped at
 *     MAX_ENRICHMENT_FINDINGS), what share did it choose to enrich? The
 *     prompt explicitly allows skipping ones it has nothing to add to
 *     (D-056), so 100% isn't the target — a coverage that's suspiciously
 *     near 0% across many cases is the signal something's wrong.
 *   verbatim rate — of the suggestion.before quotes it did produce, what
 *     share are genuine substrings of the résumé's own text? D-007's hard
 *     rule requires before to be verbatim; unlike suggestion.after (already
 *     spot-checked by local-model-compare.ts's word-level fabrication
 *     heuristic), before is checkable exactly, not just heuristically.
 *
 *   pnpm --filter @tailorats/evals exec tsx src/enrichment-eval.ts [n]
 *
 * Optional CLI arg: how many cases to run (default 4 — bounded for a quick
 * check; pass a bigger number, or omit a cap in the code, to cover more of
 * the golden set once you have minutes to spare, not just seconds).
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_CASE_LIMIT = 4;

const CaseFile = z.object({
  contexts: z.record(z.string(), z.array(z.string())),
  cases: z.array(z.object({ resume: z.string(), context: z.string() }).passthrough()),
});

const { contexts: rawContexts, cases: allCases } = CaseFile.parse(
  yaml.load(readFileSync(join(ROOT, "expected/cases.yaml"), "utf8")),
);

function packsAndContextFor(contextName: string) {
  const packIds = rawContexts[contextName];
  if (!packIds) throw new Error(`unknown context ${contextName}`);
  const packs: RulePack[] = packIds.map((id) => loadPack(id));
  const [stage, role, region] = ["stage", "role", "region"].map(
    (kind) => packIds.find((p) => p.startsWith(`${kind}/`))?.split("/")[1],
  );
  return {
    packs,
    context: { region: region ?? "us", role: role ?? "swe-intern", ...(stage ? { stage } : {}) },
  };
}

interface CaseResult {
  resume: string;
  context: string;
  succeeded: boolean;
  error?: string;
  eligibleFindings: number;
  enrichedCount: number;
  beforeQuotes: number;
  verbatimValid: number;
  ms: number;
}

async function runCase(
  provider: LocalProvider,
  c: { resume: string; context: string },
): Promise<CaseResult> {
  const doc = ResumeDoc.parse(
    JSON.parse(readFileSync(join(ROOT, "golden", `${c.resume}.json`), "utf8")),
  );
  const { packs, context } = packsAndContextFor(c.context);
  const docText = JSON.stringify(doc).toLowerCase();

  const t0 = Date.now();
  try {
    const { report, notes } = await analyze({
      source: { kind: "resumedoc", doc },
      context,
      packs,
      llm: { provider },
    });
    const ms = Date.now() - t0;
    const eligible = Math.min(report.findings.length, MAX_ENRICHMENT_FINDINGS);
    const enriched = report.findings.filter((f) => f.enriched);
    const beforeQuotes = enriched.filter((f) => f.suggestion?.before);
    const verbatimValid = beforeQuotes.filter((f) =>
      docText.includes((f.suggestion?.before ?? "").toLowerCase()),
    ).length;
    // A resolved provider can still fail internally (D-050/D-052) — analyze()
    // degrades gracefully rather than throwing, with the real reason in
    // `notes`, not an exception. Same check generateAiReview() uses.
    const failedNote = notes.find((n) => n.startsWith("AI review failed"));
    return {
      resume: c.resume,
      context: c.context,
      succeeded: report.degraded === false,
      ...(failedNote ? { error: failedNote } : {}),
      eligibleFindings: eligible,
      enrichedCount: enriched.length,
      beforeQuotes: beforeQuotes.length,
      verbatimValid,
      ms,
    };
  } catch (e) {
    return {
      resume: c.resume,
      context: c.context,
      succeeded: false,
      error: e instanceof Error ? e.message : String(e),
      eligibleFindings: 0,
      enrichedCount: 0,
      beforeQuotes: 0,
      verbatimValid: 0,
      ms: Date.now() - t0,
    };
  }
}

async function main() {
  const limit = Number(process.argv[2]) || DEFAULT_CASE_LIMIT;
  const cases = allCases.slice(0, limit);
  const provider = new LocalProvider();

  const results: CaseResult[] = [];
  console.log(
    `Running ${cases.length} of ${allCases.length} golden cases against the local provider...\n`,
  );
  for (const c of cases) {
    process.stdout.write(`  ${c.resume} × ${c.context} ... `);
    const r = await runCase(provider, c);
    results.push(r);
    console.log(
      r.succeeded
        ? `ok (${r.enrichedCount}/${r.eligibleFindings} enriched, ${r.verbatimValid}/${r.beforeQuotes} verbatim, ${r.ms}ms)`
        : `FAILED (${r.ms}ms) — ${r.error ?? "unknown"}`,
    );
  }

  const succeeded = results.filter((r) => r.succeeded);
  const totalEligible = succeeded.reduce((a, r) => a + r.eligibleFindings, 0);
  const totalEnriched = succeeded.reduce((a, r) => a + r.enrichedCount, 0);
  const totalBefore = succeeded.reduce((a, r) => a + r.beforeQuotes, 0);
  const totalVerbatim = succeeded.reduce((a, r) => a + r.verbatimValid, 0);
  const coverage = totalEligible > 0 ? totalEnriched / totalEligible : 0;
  const verbatimRate = totalBefore > 0 ? totalVerbatim / totalBefore : 1;

  console.log("-".repeat(72));
  console.log(
    `${succeeded.length}/${results.length} cases succeeded · ` +
      `coverage ${(coverage * 100).toFixed(0)}% (${totalEnriched}/${totalEligible} eligible findings enriched) · ` +
      `verbatim ${(verbatimRate * 100).toFixed(0)}% (${totalVerbatim}/${totalBefore} before-quotes are real résumé substrings)`,
  );
}

main();
