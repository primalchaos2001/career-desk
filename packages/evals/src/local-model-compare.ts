import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "@huggingface/transformers";
import { ResumeDoc } from "@tailorats/core";
import { LocalProvider } from "@tailorats/llm";
import { analyze } from "@tailorats/pipeline";
import type { RulePack } from "@tailorats/rules";
import { loadPack } from "@tailorats/rules/node";

/**
 * On-device model comparison (O-18, D-057/D-059) — NOT in CI. Real downloads
 * (each candidate model, once) + real CPU inference (device pinned "cpu"
 * under Node per D-051), so this is slow — expect several minutes total, not
 * seconds. Scores the *enrichment* task (D-057: the on-device path patches
 * why/suggestion on findings the deterministic engine already produced, it
 * doesn't independently re-review), not the exact-match rule-pack regression
 * `pnpm eval` already covers — that part is untouched by which model runs.
 *
 *   pnpm --filter @tailorats/evals exec tsx src/local-model-compare.ts [model-index-or-name]
 *
 * Optional CLI arg: an index into MODELS (0,1,2,...) or a substring of a
 * model name — runs just that one model as its own process, then exits. On
 * a memory-constrained machine, run each model as a SEPARATE invocation
 * (not this script's own all-models loop) — a fresh process guarantees the
 * previous model's session/weights are fully released by the OS, which
 * in-process GC of an onnxruntime session isn't guaranteed to do promptly.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Candidates, found live running this comparison, not assumed:
 * - SmolLM2-135M/360M-ONNX (base, no chat_template) fail immediately —
 *   LocalProvider needs one to format the chat-message array. Dropped.
 * - SmolLM2-135M/360M-Instruct-ONNX (chat_template present) hit a real
 *   onnxruntime-node@1.24.3 graph-fusion crash ("SimplifiedLayerNormFusion")
 *   on this Llama-architecture export; the disable-optimization workaround
 *   below unblocks it but inference then didn't finish a single case in
 *   4+ minutes. Dropped — genuinely not viable right now, not a close call.
 * - Qwen2.5-0.5B-Instruct-ONNX hits the same fusion crash, unblocked by the
 *   same workaround, and runs at a normal speed once unblocked. Kept.
 * - Gemma-3-270m-it-ONNX runs without the workaround but took ~4 minutes for
 *   a single case and failed to produce valid JSON within the 1024-token
 *   budget even then. Kept anyway — a real, reportable data point (too slow
 *   and unreliable for this task at this size), not dropped for looking bad.
 * - Qwen3-0.6B-ONNX needs no workaround at all — the only architecture of
 *   the four that doesn't hit the fusion bug. Current shipped default (D-058).
 */
const NEEDS_OPT_DISABLED = new Set(["onnx-community/Qwen2.5-0.5B-Instruct-ONNX"]);

function createGeneratorFor(model: string): typeof pipeline {
  if (!NEEDS_OPT_DISABLED.has(model)) return pipeline;
  return (task, m, opts) =>
    pipeline(task, m, {
      ...opts,
      session_options: { graphOptimizationLevel: "disabled" },
    } as Parameters<typeof pipeline>[2]);
}

const MODELS = [
  "onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
  "onnx-community/gemma-3-270m-it-ONNX",
  "onnx-community/Qwen3-0.6B-ONNX", // current shipped default (D-058)
];

// Deliberately small and diverse (region/role spread) — this is a real-
// inference comparison run, not the fast golden-set regression.
const CASES: { resume: string; context: string; packs: string[] }[] = [
  {
    resume: "us-clean-swe",
    context: "us",
    packs: ["stage/student", "role/swe-intern", "region/us"],
  },
  {
    resume: "mba-weak",
    context: "us-mba",
    packs: ["stage/student", "role/mba-applicant", "region/us"],
  },
  {
    resume: "vlsi-de-strong",
    context: "de-vlsi",
    packs: ["stage/student", "role/dv-engineer", "region/de"],
  },
  {
    resume: "pm-us-weak",
    context: "us-pm",
    packs: ["stage/student", "role/product-manager", "region/us"],
  },
];

interface CaseResult {
  resume: string;
  succeeded: boolean;
  error?: string;
  totalFindings: number;
  enrichedCount: number;
  suspectRewrites: number;
  ms: number;
}

/**
 * Fact-preservation heuristic (not a formal proof — a defensible proxy given
 * the time budget for this comparison, same spirit as D-016's "no original
 * token survives" contract, inverted): every ≥4-char alphanumeric word in a
 * rewrite's "after" must trace back to the résumé JSON somewhere. A rewrite
 * that introduces a word the résumé never contained is a plausible
 * fabrication and counted as suspect.
 */
function isSuspectRewrite(after: string, docText: string): boolean {
  const words = after.match(/[a-z0-9]{4,}/gi) ?? [];
  return words.some((w) => !docText.includes(w.toLowerCase()));
}

async function runCase(model: string, c: (typeof CASES)[number]): Promise<CaseResult> {
  const doc = ResumeDoc.parse(
    JSON.parse(readFileSync(join(ROOT, "golden", `${c.resume}.json`), "utf8")),
  );
  const packs: RulePack[] = c.packs.map((id) => loadPack(id));
  const [stage, role, region] = ["stage", "role", "region"].map(
    (kind) => c.packs.find((p) => p.startsWith(`${kind}/`))?.split("/")[1],
  );
  const provider = new LocalProvider({ model, createGenerator: createGeneratorFor(model) });
  const docText = JSON.stringify(doc).toLowerCase();

  const t0 = Date.now();
  try {
    const { report } = await analyze({
      source: { kind: "resumedoc", doc },
      context: { region: region ?? "us", role: role ?? "swe-intern", ...(stage ? { stage } : {}) },
      packs,
      llm: { provider },
    });
    const ms = Date.now() - t0;
    const enriched = report.findings.filter((f) => f.enriched);
    const suspectRewrites = enriched.filter(
      (f) => f.suggestion?.after && isSuspectRewrite(f.suggestion.after, docText),
    ).length;
    return {
      resume: c.resume,
      succeeded: report.degraded === false,
      totalFindings: report.findings.length,
      enrichedCount: enriched.length,
      suspectRewrites,
      ms,
    };
  } catch (e) {
    return {
      resume: c.resume,
      succeeded: false,
      error: e instanceof Error ? e.message : String(e),
      totalFindings: 0,
      enrichedCount: 0,
      suspectRewrites: 0,
      ms: Date.now() - t0,
    };
  }
}

// Persisted across separate process invocations (recommended on a memory-
// constrained machine — see the CLI-arg comment above) so the final table
// can show every model run so far, not just this invocation's.
const RESULTS_FILE = join(ROOT, ".local-model-compare-results.json");

function loadAllResults(): Record<string, CaseResult[]> {
  if (!existsSync(RESULTS_FILE)) return {};
  return JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
}

function saveResults(all: Record<string, CaseResult[]>): void {
  writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2));
}

function printTable(all: Record<string, CaseResult[]>): void {
  console.log(`\n${"model".padEnd(42)}success  coverage  suspect  avg ms`);
  console.log("-".repeat(80));
  for (const [model, results] of Object.entries(all)) {
    const succeeded = results.filter((r) => r.succeeded);
    const successRate = succeeded.length / results.length;
    const totalFindings = succeeded.reduce((a, r) => a + r.totalFindings, 0);
    const totalEnriched = succeeded.reduce((a, r) => a + r.enrichedCount, 0);
    const totalSuspect = succeeded.reduce((a, r) => a + r.suspectRewrites, 0);
    const avgMs = succeeded.length
      ? Math.round(succeeded.reduce((a, r) => a + r.ms, 0) / succeeded.length)
      : 0;
    const coverage = totalFindings > 0 ? totalEnriched / totalFindings : 0;
    console.log(
      `${model.padEnd(42)}${(successRate * 100).toFixed(0).padStart(6)}%  ` +
        `${(coverage * 100).toFixed(0).padStart(7)}%  ${String(totalSuspect).padStart(7)}  ${String(avgMs).padStart(6)}`,
    );
  }
  console.log(
    "\nsuccess = valid structured output on every case · coverage = share of findings the model chose to enrich",
  );
  console.log(
    "suspect = rewrites containing a word not found anywhere in the résumé (fabrication heuristic, not a proof)",
  );
}

function selectModels(): string[] {
  const arg = process.argv[2];
  if (!arg) return MODELS;
  const byIndex = MODELS[Number(arg)];
  if (byIndex) return [byIndex];
  const byName = MODELS.filter((m) => m.toLowerCase().includes(arg.toLowerCase()));
  if (byName.length === 0) {
    console.error(
      `No model matches "${arg}". Options:\n${MODELS.map((m, i) => `  ${i}: ${m}`).join("\n")}`,
    );
    process.exit(1);
  }
  return byName;
}

async function main() {
  const selected = selectModels();
  const all = loadAllResults();

  for (const model of selected) {
    console.log(`\n=== ${model} ===`);
    const results: CaseResult[] = [];
    for (const c of CASES) {
      process.stdout.write(`  ${c.resume} × ${c.context} ... `);
      const r = await runCase(model, c);
      results.push(r);
      if (r.succeeded) {
        console.log(
          `ok (${r.enrichedCount}/${r.totalFindings} enriched, ${r.suspectRewrites} suspect, ${r.ms}ms)`,
        );
      } else {
        console.log(`FAILED (${r.ms}ms) — ${r.error ?? "unknown"}`);
      }
    }
    all[model] = results;
    saveResults(all); // written after each model, not just at the end
  }

  printTable(all);
}

main();
