import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Assemble the Windows download: everything Career Desk needs to run, without
 * source code or node_modules. Usage:
 *   node scripts/package-windows.mjs [--node <folder holding node.exe>] [--out release/CareerDesk]
 * Build first: pnpm --filter @tailorats/app run local:build
 * The release workflow zips the output folder and attaches it to a GitHub release.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = path.resolve(root, arg("--out") ?? "release/CareerDesk");
const nodeDir = arg("--node");
const app = path.join(root, "packages", "app");

for (const need of [
  "dist/index.html",
  "dist-local/career-desk.mjs",
  "dist-mcp/career-desk-mcp.mjs",
])
  if (!existsSync(path.join(app, need)))
    throw new Error(
      `Missing packages/app/${need}. Run: pnpm --filter @tailorats/app run local:build`,
    );
if (path.relative(root, out).startsWith(".."))
  throw new Error("--out must be inside the repository");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = (from, to = from) =>
  cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy("Career Desk.cmd");
copy("LICENSE");
copy("README.md");
copy("third_party");
copy(path.join("tools", "python"));
for (const dir of ["dist", "dist-local", "dist-mcp"]) copy(path.join("packages", "app", dir));
if (nodeDir) {
  if (!existsSync(path.join(nodeDir, "node.exe"))) throw new Error(`No node.exe in ${nodeDir}`);
  cpSync(nodeDir, path.join(out, "runtime", "node"), { recursive: true });
}
writeFileSync(
  path.join(out, "START HERE.txt"),
  [
    "Career Desk",
    "",
    "1. Double-click 'Career Desk.cmd'. Your browser opens Career Desk.",
    "2. Keep the black window open while you use it. Close it to stop.",
    "",
    "The first start sets up job-board search and CV PDFs (about a minute, needs internet).",
    "That part needs Python 3.10 or later: https://www.python.org/downloads/",
    "(tick 'Add python.exe to PATH' when installing). Everything else works without it.",
    "",
    "Your data stays on this PC in your user folder, under CareerDesk.",
    "",
  ].join("\r\n"),
);
console.log(`Prepared ${path.relative(root, out)}${nodeDir ? " (with Node)" : " (without Node)"}`);
