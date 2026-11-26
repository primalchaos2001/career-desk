import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdf, extractResumeDoc, parseTexResume, ResumeDoc } from "@tailorats/core";
import { analyze } from "@tailorats/pipeline";
import type { RulePack } from "@tailorats/rules";
import { loadPack } from "@tailorats/rules/node";
import yaml from "js-yaml";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_ROOT = join(ROOT, "../../");

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

const { contexts: rawContexts } = CaseFile.parse(
  yaml.load(readFileSync(join(ROOT, "expected/cases.yaml"), "utf8")),
);

// Load all contexts/packs
const contexts: Record<string, RulePack[]> = {};
for (const [name, packIds] of Object.entries(rawContexts)) {
  contexts[name] = packIds.map((packId) => loadPack(packId));
}

// Load golden resumes
const goldenResumes: Record<string, ResumeDoc> = {};
const goldenFiles = readdirSync(join(ROOT, "golden")).filter((f) => f.endsWith(".json"));
for (const f of goldenFiles) {
  const name = f.replace(/\.json$/, "");
  goldenResumes[name] = ResumeDoc.parse(JSON.parse(readFileSync(join(ROOT, "golden", f), "utf8")));
}

// Parse local LaTeX resumes
const localResumes: Record<string, ResumeDoc> = {};
try {
  const mainSrc = readFileSync(join(WORKSPACE_ROOT, "samples/main.tex"), "utf8");
  localResumes.main = parseTexResume(mainSrc);
} catch (e) {
  console.error("Error reading samples/main.tex:", e);
}
try {
  const resumeSrc = readFileSync(join(WORKSPACE_ROOT, "samples/resume.tex"), "utf8");
  localResumes.resume = parseTexResume(resumeSrc);
} catch (e) {
  console.error("Error reading samples/resume.tex:", e);
}
try {
  const pdfBytes = new Uint8Array(
    readFileSync(join(WORKSPACE_ROOT, "packages/core/test/fixtures/pdf/dv-engineer-sample.pdf")),
  );
  const pdfData = await extractPdf(pdfBytes);
  localResumes["dv-engineer-sample"] = extractResumeDoc(pdfData);
} catch (e) {
  console.error("Error reading packages/core/test/fixtures/pdf/dv-engineer-sample.pdf:", e);
}

const allResumes = { ...goldenResumes, ...localResumes };

const NATIVE_CONTEXTS: Record<string, string> = {
  "us-clean-swe": "us",
  "india-style-applied-to-us": "india",
  "india-fresher-3page": "india",
  "no-projects-student": "us",
  "no-github-swe": "us",
  "unlinked-projects": "us",
  "duty-bullets": "us",
  "no-gpa": "us",
  "no-coursework": "us",
  "en-gb-in-us": "us",
  "kitchen-sink-bad": "us",
  "rich-newgrad-1p": "us",
  "twocolumn-layout": "us",
  "finance-target": "us-finance",
  "non-cs-major": "us",
  "uk-style-fresher": "uk",
  "de-style-fresher": "de",
  "data-analyst-clean": "us-data",
  "data-analyst-bad": "us-data",
  "finance-analyst-clean": "us-finance",
  "ib-ready": "us-ib",
  "ib-bad": "us-ib",
  "uk-photo-resume": "uk",
  "de-traditional-lebenslauf": "de",
  "uk-overlong": "uk",
  "de-overlong": "de",
  "mech-engineer": "us-mech",
  "mech-engineer-clean": "us-mech",
  "mech-engineer-bad": "us-mech",
  "ee-intern-clean": "us-ee",
  "ee-intern-bad": "us-ee",
  "consulting-clean": "us-consulting",
  "consulting-bad": "us-consulting",
  "swe-uk-strong": "uk",
  "swe-uk-weak": "uk",
  "data-de-strong": "de-data",
  "data-de-weak": "de-data",
  "ib-india-strong": "india-ib",
  "ib-india-weak": "india-ib",
  "consulting-us-strong": "us-consulting",
  "consulting-us-weak": "us-consulting",
  "pm-us-strong": "us-pm",
  "pm-us-weak": "us-pm",
  "vlsi-de-strong": "de-vlsi",
  "vlsi-de-weak": "de-vlsi",
  main: "de-vlsi",
  resume: "de-vlsi",
  "dv-engineer-sample": "de-vlsi",
};

function getAnalysisContext(contextName: string) {
  const region = contextName.startsWith("india")
    ? "IN"
    : contextName.startsWith("de")
      ? "DE"
      : contextName.startsWith("uk")
        ? "UK"
        : "US";
  const stage = "student";

  let role: string | undefined;
  let industry: string | undefined;

  if (contextName.includes("-data")) {
    role = "data-analyst";
  } else if (contextName.includes("-finance")) {
    role = "finance-analyst";
  } else if (contextName.includes("-ib")) {
    role = "ib-analyst";
    industry = "finance";
  } else if (contextName.includes("-mech")) {
    role = "mech-engineer-intern";
  } else if (contextName.includes("-ee")) {
    role = "ee-intern";
  } else if (contextName.includes("-consulting")) {
    role = "consulting-analyst";
    industry = "consulting";
  } else if (contextName.includes("-pm")) {
    role = "pm-intern";
  } else if (contextName.includes("-vlsi")) {
    role = "dv-engineer";
  } else {
    role = "swe-intern";
  }

  return { region, stage, role, industry };
}

function isStrongResume(name: string): boolean {
  if (name === "main" || name === "resume") return true;
  const lower = name.toLowerCase();
  return !(
    lower.includes("-bad") ||
    lower.includes("-weak") ||
    lower.includes("bad") ||
    lower.includes("weak") ||
    lower.includes("no-") ||
    lower.includes("unlinked") ||
    lower.includes("duty") ||
    lower.includes("overlong")
  );
}

interface MatrixResult {
  resume: string;
  context: string;
  score: number;
  grade: number;
  findings: string[];
}

async function runMatrix() {
  const results: MatrixResult[] = [];

  for (const [resumeName, doc] of Object.entries(allResumes)) {
    const nativeContext = NATIVE_CONTEXTS[resumeName] || "us";
    const strong = isStrongResume(resumeName);

    for (const contextName of Object.keys(contexts)) {
      const targetPacks = contexts[contextName] ?? [];
      const anaContext = getAnalysisContext(contextName);

      try {
        const { report } = await analyze({
          source: { kind: "resumedoc", doc },
          context: anaContext,
          packs: targetPacks,
        });

        const score = report.overall ?? 0;
        const findings = report.findings.map((f) => f.id);

        let grade = 0;
        if (contextName === nativeContext) {
          if (strong) {
            grade = score >= 70 ? 5 : 0;
          } else {
            grade = score < 70 ? 5 : 0;
          }
        } else {
          grade = score < 65 ? 5 : -5;
        }

        results.push({
          resume: resumeName,
          context: contextName,
          score,
          grade,
          findings,
        });
      } catch (err) {
        console.error(`Error analyzing ${resumeName} × ${contextName}:`, err);
      }
    }
  }

  // Generate matrix markdown file
  let md = "# Resume Scoring Matrix & Analysis\n\n";
  md += `Generated at: ${new Date().toISOString()}\n\n`;

  // Context Headers
  const ctxNames = Object.keys(contexts);
  md += `| Resume | ${ctxNames.join(" | ")} | Total Grade |\n`;
  md += `| --- | ${ctxNames.map(() => "---").join(" | ")} | --- |\n`;

  const resumeNames = Object.keys(allResumes);
  let totalOverallGrade = 0;

  for (const resumeName of resumeNames) {
    let row = `| **${resumeName}** | `;
    let totalResumeGrade = 0;

    for (const ctx of ctxNames) {
      const res = results.find((r) => r.resume === resumeName && r.context === ctx);
      if (res) {
        const native = NATIVE_CONTEXTS[resumeName] === ctx ? "🎯" : "";
        row += `${res.score} (${res.grade > 0 ? `+${res.grade}` : res.grade})${native} | `;
        totalResumeGrade += res.grade;
      } else {
        row += "N/A | ";
      }
    }

    totalOverallGrade += totalResumeGrade;
    row += `**${totalResumeGrade}** |\n`;
    md += row;
  }

  md += `\n**Total Score Grade Across All Combinations: ${totalOverallGrade}**\n`;

  writeFileSync(join(ROOT, "src/matrix_output.md"), md);
  console.log(`Matrix analysis output written to ${join(ROOT, "src/matrix_output.md")}`);
}

runMatrix().catch((err) => {
  console.error("Matrix execution failed:", err);
  process.exit(1);
});
