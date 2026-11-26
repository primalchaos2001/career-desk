import { defineConfig } from "vite";

/**
 * Bundles the Career Desk launcher server into one file that runs with plain
 * `node` (started by `Career Desk.cmd`). Build: pnpm --filter @tailorats/app run local:build
 */
export default defineConfig({
  build: {
    ssr: "server/local/cli.ts",
    outDir: "dist-local",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: { output: { entryFileNames: "career-desk.mjs", format: "es" } },
  },
  ssr: { noExternal: true, target: "node" },
});
