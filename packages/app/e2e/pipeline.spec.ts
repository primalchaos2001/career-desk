import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * Real-browser verification (O-08, D-033): drives the harness page in
 * Chromium, uploads fixture resumes, and asserts the pipeline produced the
 * same findings the Node tests expect. This is what makes "runs in the
 * browser" a checked claim rather than an assumption.
 */

const fixture = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const PDF_INDIA = fixture("../../core/test/fixtures/pdf/india-fresher.pdf");
const PDF_CLEAN = fixture("../../core/test/fixtures/pdf/us-clean.pdf");
const TEX_CLEAN = fixture("../../evals/golden/tex/jakes-clean-swe.tex");

async function analyze(page: import("@playwright/test").Page, file: string, region = "us") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/harness/");
  // The harness spawns its worker at page load, before any file is selected.
  // In dev mode, a cold Vite dependency scan can't see into @tailorats/llm's
  // deps (an excluded workspace package, D-033) and only discovers
  // @huggingface/transformers (D-049) once the worker really loads it —
  // triggering one reload shortly after this navigation. Letting it settle
  // here, before interacting, keeps it from interrupting the actual analysis
  // mid-flight (dev-mode-only; the production build pre-bundles everything
  // and never reloads — see playwright.config.ts's timeout comment).
  await page.waitForTimeout(8_000);
  await page.selectOption("#region", region);
  await page.setInputFiles("#file", file);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  expect(errors, "uncaught page errors").toEqual([]);
  return page.locator(".finding");
}

test("PDF analysed in-browser: pdf.js parses, region signals fire, rules produce findings", async ({
  page,
}) => {
  const findings = await analyze(page, PDF_INDIA, "us");
  const ids = await findings.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.id ?? ""),
  );
  for (const expected of [
    "us-no-photo",
    "us-no-personal-details",
    "us-one-page",
    "us-spelling",
    "us-no-declaration",
    "fid-images",
  ]) {
    expect(ids).toContain(expected);
  }
  // P0s render first — same ordering guarantee as the Node pipeline
  await expect(findings.first()).toHaveAttribute("data-priority", "P0");
  await expect(page.locator("#scores")).toContainText("fidelity:");
  await expect(page.locator("#notes")).toContainText("No AI key");
});

test("the same PDF is clean under its own region (india) — context actually applies", async ({
  page,
}) => {
  const findings = await analyze(page, PDF_INDIA, "india");
  const ids = await findings.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.id ?? ""),
  );
  expect(ids).not.toContain("us-no-photo");
  expect(ids).not.toContain("us-no-declaration");
});

test("clean US PDF scores 100 fidelity in-browser", async ({ page }) => {
  await analyze(page, PDF_CLEAN, "us");
  await expect(page.locator("#scores")).toContainText("fidelity: 100");
});

test(".tex parsed in-browser by unified-latex", async ({ page }) => {
  const findings = await analyze(page, TEX_CLEAN, "us");
  const ids = await findings.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.id ?? ""),
  );
  expect(ids).toContain("stu-coursework");
  // .tex has no pageCount → the page-length rule must not fire
  expect(ids).not.toContain("us-one-page");
});

test("no network requests leave the browser during analysis", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("http://localhost") && !url.startsWith("data:") && !url.startsWith("blob:"))
      external.push(url);
  });
  await analyze(page, PDF_INDIA, "us");
  expect(external, "resume analysis must not contact any server").toEqual([]);
});
