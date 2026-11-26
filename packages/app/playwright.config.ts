import { defineConfig } from "@playwright/test";
import { E2E_DIR, resetWorkspaceFolder } from "./e2e/folder";

/**
 * E2E_PREVIEW=1 runs the suite against the production static build (the actual
 * deploy artifact) instead of the dev server — dev and prod resolve workers
 * differently, so both are verified (D-033).
 */
const preview = process.env.E2E_PREVIEW === "1";
// Never the real ~/CareerDesk: the server gets a throwaway folder (e2e/folder.ts).
resetWorkspaceFolder();

export default defineConfig({
  testDir: "./e2e",
  // Dev-mode only: @huggingface/transformers (D-049) is a much larger
  // optimize-deps target than this project's earlier worker deps, so a cold
  // Vite dep-scan under concurrent test load can run long. The production
  // build (E2E_PREVIEW=1, what's actually deployed) sees none of this —
  // everything is pre-bundled at build time, confirmed consistently <3s/test.
  timeout: preview ? 60_000 : 150_000,
  fullyParallel: true,
  // Dev-mode only: parallel workers all cold-hit the same dev server at once,
  // so they compete for Vite's one-time optimize-deps pass on
  // @huggingface/transformers instead of one paying that cost while the rest
  // wait — serialize so exactly one request pays it, then the rest reuse the
  // now-warm cache. Preview/prod keeps full parallelism (nothing to warm).
  // Both modes: the Career Desk tests share the server's one workspace folder,
  // so they must not run at the same time (each starts by emptying it).
  workers: 1,
  use: { baseURL: `http://localhost:${preview ? 5200 : 5199}` },
  webServer: {
    command: preview
      ? "pnpm exec vite build && pnpm exec vite preview --port 5200 --strictPort --host"
      : "pnpm exec vite --port 5199 --strictPort --host",
    url: `http://localhost:${preview ? 5200 : 5199}`,
    reuseExistingServer: false,
    env: { CAREER_DESK_DIR: E2E_DIR },
    timeout: 180_000,
  },
});
