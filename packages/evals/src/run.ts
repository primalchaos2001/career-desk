import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResumeDoc } from "@tailorats/core";
import { evaluate, type RulePack } from "@tailorats/rules";
import { loadPack } from "@tailorats/rules/node";
import yaml from "js-yaml";
import { z } from "zod";

/**
 * Golden-set eval runner (docs/ARCHITECTURE.md §10). Deterministic layers are
 * held to exact-match: any unexpected or missing finding fails the run. Run
 * with `pnpm eval` from the repo root; CI runs it on every PR.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const CaseFile = z.object({
  contexts: z.record(z.string(), z.array(z.string())),
  cases: z.array(
    z.object({
      resume: z.string(),
      context: z.string(),
      expected: z.array(z.string()),
    }),
  ),
});

const { contexts: rawContexts, cases } = CaseFile.parse(
  yaml.load(readFileSync(join(ROOT, "expected/cases.yaml"), "utf8")),
);

const contexts: Record<string, RulePack[]> = {};
for (const [name, packIds] of Object.entries(rawContexts)) {
  contexts[name] = packIds.map((packId) => {
    try {
      return loadPack(packId);
    } catch (e) {
      console.error(`Error loading pack "${packId}" for context "${name}":`, e);
      throw e;
    }
  });
}

const goldenIds = readdirSync(join(ROOT, "golden"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const uncovered = goldenIds.filter((id) => !cases.some((c) => c.resume === id));
if (uncovered.length > 0) {
  console.error(`golden resumes with no expectations: ${uncovered.join(", ")}`);
  process.exit(1);
}

let tp = 0;
let fp = 0;
let fn = 0;
let failedCases = 0;

console.log(`${"case".padEnd(38)}result`);
console.log("-".repeat(72));

for (const c of cases) {
  const doc = ResumeDoc.parse(
    JSON.parse(readFileSync(join(ROOT, "golden", `${c.resume}.json`), "utf8")),
  );
  const packs = contexts[c.context];
  if (!packs) throw new Error(`unknown context ${c.context}`);

  const got = new Set(evaluate(doc, packs).map((f) => f.id));
  const want = new Set(c.expected);
  const missing = [...want].filter((id) => !got.has(id));
  const unexpected = [...got].filter((id) => !want.has(id));

  tp += [...got].filter((id) => want.has(id)).length;
  fp += unexpected.length;
  fn += missing.length;

  const label = `${c.resume} × ${c.context}`;
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`${label.padEnd(38)}ok (${want.size} findings)`);
  } else {
    failedCases++;
    console.log(`${label.padEnd(38)}FAIL`);
    if (missing.length > 0) console.log(`  missing:    ${missing.join(", ")}`);
    if (unexpected.length > 0) console.log(`  unexpected: ${unexpected.join(", ")}`);
  }
}

const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

console.log("-".repeat(72));
console.log(
  `${cases.length} cases, ${failedCases} failed · precision ${(precision * 100).toFixed(1)}% · recall ${(recall * 100).toFixed(1)}%`,
);

if (failedCases > 0) process.exit(1);
