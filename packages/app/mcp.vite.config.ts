import { defineConfig } from "vite";

/**
 * Bundles the Career Desk MCP server into one self-contained file that assistant
 * apps can start with plain `node` (no pnpm, tsx or node_modules needed at runtime).
 * Build: pnpm --filter @tailorats/app run mcp:build
 */
export default defineConfig({
  build: {
    ssr: "server/mcp/cli.ts",
    outDir: "dist-mcp",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: { output: { entryFileNames: "career-desk-mcp.mjs", format: "es" } },
  },
  ssr: { noExternal: true, target: "node" },
});
