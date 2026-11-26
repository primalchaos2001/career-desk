import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright specs live in packages/app/e2e and must not be collected by
    // vitest — they run via `pnpm e2e` in a real browser (D-033).
    include: ["packages/*/test/**/*.test.ts"],
  },
});
