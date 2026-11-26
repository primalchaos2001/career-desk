import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirror the existing Vite output into the root static directory for Sites.
// A new output folder is built each time; deployment packages only this tree.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "packages", "app", "dist");
const output = path.join(root, "dist");
if (!existsSync(path.join(input, "index.html"))) throw new Error("Build the Vite app first");
if (path.relative(root, output) !== "dist")
  throw new Error("Static output must be the checkout's dist directory");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of readdirSync(input))
  cpSync(path.join(input, name), path.join(output, name), { recursive: true });
console.log("Prepared static site in dist/");
