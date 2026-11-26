import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTexResume } from "@tailorats/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = join(__dirname, "../../../");

const mainSource = readFileSync(join(workspaceRoot, "samples/main.tex"), "utf-8");
const resumeSource = readFileSync(join(workspaceRoot, "samples/resume.tex"), "utf-8");

console.log("=== PARSING samples/main.tex ===");
try {
  const doc = parseTexResume(mainSource);
  console.log(JSON.stringify(doc, null, 2));
} catch (err) {
  console.error("Error parsing main.tex:", err);
}

console.log("\n=== PARSING samples/resume.tex ===");
try {
  const doc = parseTexResume(resumeSource);
  console.log(JSON.stringify(doc, null, 2));
} catch (err) {
  console.error("Error parsing resume.tex:", err);
}
