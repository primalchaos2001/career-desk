import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceFolder } from "./server/workspaceFolder";

const rawDir = fileURLToPath(new URL(".", import.meta.url));
const dir =
  /^[a-z]:/i.test(rawDir) && rawDir.length > 0
    ? rawDir.charAt(0).toUpperCase() + rawDir.slice(1)
    : rawDir;

/**
 * Static SPA build (D-026, Start→SPA ADR): plain Vite + TanStack Router (no
 * Start, no server runtime), React, and Tailwind v4. Two HTML entries — the
 * real CV Guide UI at `/` and the low-level pipeline harness at `/harness/`
 * that the Playwright pipeline suite drives (D-033/D-034).
 */

/**
 * Deps reached only from inside the Web Worker (or via dynamic import) are
 * discovered *after* the dev server starts, which triggers a full page reload
 * mid-analysis (D-036). Listing them makes Vite pre-bundle them at startup.
 */
const WORKER_DEPS = [
  "pdfjs-dist/legacy/build/pdf.mjs",
  "@unified-latex/unified-latex-util-parse",
  "@unified-latex/unified-latex-util-arguments",
  "zod",
  // reached transitively via @tailorats/llm's factory (D-049/D-052) — same
  // undiscovered-worker-dep reload failure mode as the others (D-036).
  "@huggingface/transformers",
];

// Normalize the project root drive letter on Windows to uppercase.
// Vite compares paths case-sensitively in the module graph, so if process.cwd()
// starts with a lowercase drive letter (e.g. c:\), it will fail to match files
// resolved with uppercase drive letters (e.g. C:\) and serve them untranspiled (D-033).
const projectRoot = process.cwd();
const normalizedRoot =
  /^[a-z]:/i.test(projectRoot) && projectRoot.length > 0
    ? projectRoot.charAt(0).toUpperCase() + projectRoot.slice(1)
    : projectRoot;

export default defineConfig({
  root: normalizedRoot,
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    // Shares workspace.json on disk with assistants (dev/preview only, not in the static build).
    workspaceFolder(),
  ],
  resolve: {
    alias: { "@": resolve(dir, "src") },
  },
  optimizeDeps: {
    // Workspace packages must resolve to a single source instance — pre-bundling
    // them duplicates modules across the app/worker boundary (D-033).
    exclude: ["@tailorats/core", "@tailorats/rules", "@tailorats/pipeline", "@tailorats/llm"],
    include: WORKER_DEPS,
    // The static HTML-entry crawl doesn't walk into an excluded workspace
    // package's own dependencies, so @huggingface/transformers (only reached
    // via the excluded @tailorats/llm) never got discovered at boot despite
    // being listed in `include` above ("Failed to resolve dependency" warning
    // + a mid-request reload once the worker really loaded it — D-036/D-052).
    // Pointing the scanner at worker.ts directly fixes the discovery, not just
    // the symptom.
    entries: ["src/worker.ts"],
  },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        main: resolve(dir, "index.html"),
        harness: resolve(dir, "harness/index.html"),
      },
    },
  },
});
