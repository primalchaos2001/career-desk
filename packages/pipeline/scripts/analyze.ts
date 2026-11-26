/**
 * Node CLI for manual testing and the D-018 tracking-ledger workflow:
 *   pnpm analyze <file.pdf|file.tex|file.json> --region us --role swe-intern [--stage student]
 *     [--industry finance] [--jd path.txt] [--github] [--pat TOKEN]
 * LLM keys via env: GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY /
 * ANTHROPIC_API_KEY, or a local Ollama. No key → degraded report.
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import process from "node:process";
import { ResumeDoc } from "@tailorats/core";
import { loadPack } from "@tailorats/rules/node";
import { type AnalyzeSource, analyze } from "../src/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// pnpm --filter runs with cwd = the package dir; resolve user paths from
// where the command was actually invoked (pnpm sets INIT_CWD).
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const rawFile = process.argv[2];
const file = rawFile ? resolve(invokedFrom, rawFile) : undefined;
const region = arg("region");
const role = arg("role");
if (!file || !region || !role) {
  console.error(
    "usage: pnpm analyze <file> --region <region> --role <role> [--stage s] [--industry i] [--jd file] [--github] [--pat token]",
  );
  process.exit(1);
}

const stage = arg("stage") ?? "student";
const industry = arg("industry");
const jdRaw = arg("jd");
const jdPath = jdRaw ? resolve(invokedFrom, jdRaw) : undefined;

const packs = [loadPack(`stage/${stage}`), loadPack(`role/${role}`), loadPack(`region/${region}`)];
if (industry) packs.splice(1, 0, loadPack(`industry/${industry}`));

const ext = extname(file).toLowerCase();
const source: AnalyzeSource =
  ext === ".pdf"
    ? { kind: "pdf", data: new Uint8Array(readFileSync(file)) }
    : ext === ".tex"
      ? { kind: "tex", source: readFileSync(file, "utf8") }
      : { kind: "resumedoc", doc: ResumeDoc.parse(JSON.parse(readFileSync(file, "utf8"))) };

const env = process.env;
const { report, notes } = await analyze({
  source,
  context: {
    region,
    role,
    stage,
    ...(industry ? { industry } : {}),
    ...(jdPath ? { jobDescription: readFileSync(jdPath, "utf8") } : {}),
  },
  packs,
  llm: {
    config: {
      ...(env.GEMINI_API_KEY ? { geminiApiKey: env.GEMINI_API_KEY } : {}),
      ...(env.GROQ_API_KEY ? { groqApiKey: env.GROQ_API_KEY } : {}),
      ...(env.OPENROUTER_API_KEY ? { openrouterApiKey: env.OPENROUTER_API_KEY } : {}),
      ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    },
  },
  ...(process.argv.includes("--github")
    ? { github: { ...(arg("pat") ? { pat: arg("pat") as string } : {}) } }
    : {}),
});

console.log(`\n=== TailorATS report (${region} × ${role}${industry ? ` × ${industry}` : ""}) ===`);
if (report.degraded) console.log("MODE: degraded (no LLM provider — deterministic layers only)\n");
const s = report.scores;
if (report.overall !== undefined) console.log(`OVERALL: ${report.overall}/100`);
if (report.sections) {
  const order = ["contact", "experience", "projects", "skills", "education", "format"] as const;
  const line = order
    .filter((k) => report.sections?.[k] !== undefined)
    .map((k) => `${k} ${report.sections?.[k]}`)
    .join(" · ");
  console.log(`sections: ${line}`);
}
console.log(
  `layers: fidelity ${s.fidelity ?? "–"} · findability ${s.findability ?? "–"} · impact ${s.impact ?? "–"}\n`,
);
if (report.readouts) {
  for (const r of report.readouts) {
    console.log(`--- ${r.section} (${r.score}/100) ---`);
    for (const t of r.strengths) console.log(`  + ${t}`);
    for (const t of r.gaps) console.log(`  - ${t}`);
    console.log(`  benchmark: ${r.benchmark}`);
  }
  console.log();
}
for (const f of report.findings) {
  console.log(`[${f.priority}] (${f.layer}) ${f.title}`);
  console.log(`     evidence: ${f.evidence}`);
  console.log(`     why: ${f.why}`);
  if (f.suggestion?.after) console.log(`     try: ${f.suggestion.after}`);
  console.log(`     source: ${f.source}\n`);
}
if (report.findings.length === 0) console.log("no findings — clean for this context\n");
for (const n of notes) console.log(`note: ${n}`);
