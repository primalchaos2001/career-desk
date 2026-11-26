import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * Real-UI verification (O-12, D-026): drives the actual CV Guide SPA in
 * Chromium — context selectors → upload → the report page rendered from the
 * real pipeline (via the Web Worker) and persisted to IndexedDB. The lower
 * level (worker/pipeline in isolation) is covered by pipeline.spec.ts against
 * the /harness page; this proves the shipped product wires end to end.
 */

const fixture = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const PDF_INDIA = fixture("../../core/test/fixtures/pdf/india-fresher.pdf");
const TEX_CLEAN = fixture("../../evals/golden/tex/jakes-clean-swe.tex");

async function uploadAndAnalyze(
  page: import("@playwright/test").Page,
  region: string,
  file = PDF_INDIA,
  heading = "india-fresher.pdf",
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // O-19/D-056: AI review is an opt-in button now, not a background pass, so
  // these tests are zero-network by construction — they never click it.
  await page.selectOption("#ctx-region", region);
  await page.setInputFiles('input[type="file"]', file);
  // D-043 made analysis an explicit action (was auto-analyzing on file drop,
  // no chance to set context first) — the button only enables once a file is set.
  await page.getByRole("button", { name: /Analyze Résumé/ }).click();
  // Analysis runs in the worker, then navigates to the report route. Headroom
  // for dev-mode's cold Vite optimize-deps pass (@huggingface/transformers,
  // D-049) — see playwright.config.ts's timeout comment; unaffected in prod.
  await page.waitForURL(/\/analyze\//, { timeout: 75_000 });
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  expect(errors, "uncaught page errors").toEqual([]);
}

test("upload PDF → real report: findings grouped by section in the shipped UI", async ({
  page,
}) => {
  await uploadAndAnalyze(page, "us");
  // Rule-pack findings surface with their cited source (real rules, not a mock).
  await expect(page.getByText("rulepack:region/us#us-no-photo")).toBeVisible();
  await expect(page.getByText("P0", { exact: true }).first()).toBeVisible();
  // The report is organized by section now, with an Overall card.
  await expect(page.getByText("Overall")).toBeVisible();
  await expect(page.getByText("Format & Parsing").first()).toBeVisible();
  // D-040: a PDF with no AI key is now deterministically extracted, so the
  // overall is a real number (not the "—" placeholder) and sections score.
  await expect(page.locator("p.font-serif.text-6xl")).toHaveText(/\d{2}/);
  await expect(page.getByText("Education").first()).toBeVisible();
});

test("upload .tex → real per-section scores render (D-039)", async ({ page }) => {
  await uploadAndAnalyze(page, "us", TEX_CLEAN, "jakes-clean-swe.tex");
  // A .tex is parsed (real content) so the deterministic engine produces an
  // overall + per-section scores — the headline of O-13.
  await expect(page.getByText("Overall")).toBeVisible();
  await expect(page.getByText("/100")).toBeVisible();
  await expect(page.getByText("Experience").first()).toBeVisible();
  await expect(page.getByText("Projects").first()).toBeVisible();
  // The overall card shows a real two-digit score, not the "—" placeholder.
  await expect(page.locator("p.font-serif.text-6xl")).toHaveText(/\d{2}/);
});

test("context applies in the UI: the same PDF is clean under its own region (india)", async ({
  page,
}) => {
  await uploadAndAnalyze(page, "india");
  await expect(page.getByText("rulepack:region/us#us-no-photo")).toHaveCount(0);
});

test("no network requests leave the browser during a real-UI analysis", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("http://localhost") && !url.startsWith("data:") && !url.startsWith("blob:"))
      external.push(url);
  });
  await uploadAndAnalyze(page, "us");
  expect(external, "resume analysis must not contact any server").toEqual([]);
});

/**
 * Improvement loop C1/C3 (docs/IMPROVEMENT-LOOP.md): verdict + reason are
 * IndexedDB-only until the user explicitly clicks a share link — these tests
 * only inspect the composed `href`, they never navigate to github.com.
 */
test("finding feedback: vote + reason composes a pre-filled GitHub issue link (C1)", async ({
  page,
}) => {
  await uploadAndAnalyze(page, "us");
  const downBtn = page.getByRole("button", { name: "Not helpful" }).first();
  await downBtn.click();

  const reasonInput = page
    .getByPlaceholder("Optional: why? (included if you share feedback)")
    .first();
  await reasonInput.fill("my career center disagrees");
  await reasonInput.blur();

  const shareLink = page.getByRole("link", { name: /Share feedback \(1\)/ });
  await expect(shareLink).toBeVisible();
  const href = (await shareLink.getAttribute("href")) ?? "";
  const params = new URL(href).searchParams;
  expect(href.startsWith("https://github.com/primalchaos2001/career-desk/issues/new")).toBe(true);
  expect(params.get("template")).toBe("feedback.yml");
  expect(params.get("verdicts")).toContain("👎");
  expect(params.get("verdicts")).toContain("my career center disagrees");
  expect(params.get("context")).toBe("us / swe-intern / tech / student");
});

test("report a miss link is always available and pre-fills context (C3)", async ({ page }) => {
  await uploadAndAnalyze(page, "us");
  const missLink = page.getByRole("link", { name: "Report a miss" });
  const href = (await missLink.getAttribute("href")) ?? "";
  const params = new URL(href).searchParams;
  expect(href.startsWith("https://github.com/primalchaos2001/career-desk/issues/new")).toBe(true);
  expect(params.get("template")).toBe("miss.yml");
  expect(params.get("context")).toBe("us / swe-intern / tech / student");
});

/**
 * On-device AI review is opt-in now (O-19, D-056) — a "Generate AI review"
 * button on the report page, not a background pass. This is the only test
 * in the suite that clicks it (real HF CDN fetch, real inference).
 *
 * Uses the real production default (Qwen3-0.6B-ONNX), not a smaller stand-in
 * — D-060's model comparison found every smaller/alternate candidate
 * (SmolLM2-135M, Qwen2.5-0.5B-Instruct, gemma-3-270m-it) fails outright in
 * onnxruntime-web (missing chat_template, a graph-fusion bug, or a missing
 * CPU kernel respectively), so testing against one of those would only ever
 * exercise the Retry-button path, not real success. Qwen3-0.6B is already
 * the practical floor size-wise; there's no smaller *working* model to swap
 * in for a faster/lighter e2e run.
 *
 * The wait below tolerates BOTH outcomes on purpose: a healthy CDN resolves
 * in seconds, but building the earlier automatic version of this feature
 * surfaced a real HF Xet CDN outage that made transformers.js hang rather
 * than reject — analyzeClient.ts's `runWorker` carries a stall-based timeout
 * (resets on every progress event, fires only on genuine silence) so this
 * can't hang forever either way. This test's real job is proving it always
 * settles VISIBLY — real findings or a visible error + Retry — not that the
 * network happens to be up right now.
 */
test("AI review button downloads the model, shows progress, and always settles visibly (O-19)", async ({
  page,
}) => {
  // Downloads a ~570 MB model from Hugging Face: too slow and network-dependent
  // for every CI run (both hit the 15-minute limit on GitHub). Run on demand
  // with E2E_AI=1 before releasing changes to the AI review.
  test.skip(!process.env.E2E_AI, "Set E2E_AI=1 to run the on-device AI review tests");
  // D-060: Qwen3-0.6B is a genuine ~570MB download (the only working
  // candidate — every smaller alternative fails in onnxruntime-web). D-067:
  // a live `curl` measurement of the actual HF CDN throughput on this
  // machine came back ~1 MB/s (not a fluke — reproduced across two
  // back-to-back real test runs each stalling at ~300s with the download
  // only ~67% done), meaning the download alone can genuinely take ~9-10
  // minutes here, before any inference time on top. 330s was tuned for a
  // faster network than this one actually has right now.
  test.setTimeout(960_000);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("cv-guide.e2e.localModel", "onnx-community/Qwen3-0.6B-ONNX");
  });
  await page.selectOption("#ctx-region", "us");
  await page.setInputFiles('input[type="file"]', PDF_INDIA);
  await page.getByRole("button", { name: /Analyze Résumé/ }).click();
  await page.waitForURL(/\/analyze\//, { timeout: 75_000 });

  // Fast path: the deterministic report is already there, and the AI review
  // hasn't started — it's opt-in, so nothing has run yet.
  await expect(page.getByText("Overall")).toBeVisible();
  await expect(page.locator("p.font-serif.text-6xl")).toHaveText(/\d{2}/);

  const generateButton = page.getByRole("button", { name: "Generate AI review" });
  await expect(generateButton).toBeVisible();
  await generateButton.click();

  await expect(page.getByText(/Downloading AI model|Reviewing your résumé/)).toBeVisible({
    timeout: 15_000,
  });

  // Real CDN download or a bounded stall failure — either way it must settle
  // visibly. Success: at least one finding gets the "AI-enriched" badge
  // (D-057: on-device review enriches existing findings, it doesn't add
  // independent ones). Failure: a Retry button with a real error message,
  // never a silent hang.
  await expect(
    page.getByText("AI-enriched").or(page.getByRole("button", { name: "Retry" })),
  ).toBeVisible({ timeout: 900_000 });
});

/**
 * O-17: D-049's promise is "no server of ours, and the only third party is
 * Hugging Face's own model CDN" — this test is verification that O-14's
 * actual fetch behavior matches that promise, not new product code. It does
 * NOT replace "no network requests leave the browser during a real-UI
 * analysis" above (that test never clicks the AI button, so it stays
 * genuinely zero-network); this one clicks it and checks the *other* case:
 * every request either matches the existing localhost/data:/blob: allowlist
 * or a named Hugging Face host. A request to anything else is a real finding
 * to fix (an unexpected redirect through a third party), not a test to
 * loosen — per the board's own instruction for this task.
 */
test("on-device AI review's network activity is scoped to Hugging Face's CDN (O-17)", async ({
  page,
}) => {
  // Downloads a ~570 MB model from Hugging Face: too slow and network-dependent
  // for every CI run (both hit the 15-minute limit on GitHub). Run on demand
  // with E2E_AI=1 before releasing changes to the AI review.
  test.skip(!process.env.E2E_AI, "Set E2E_AI=1 to run the on-device AI review tests");
  // D-067: see the O-19 test above — a live-measured ~1 MB/s HF CDN
  // throughput on this machine makes the ~570MB download alone take ~9-10
  // minutes some days, well past the old 330s budget.
  test.setTimeout(960_000);
  const HF_HOST = /^([a-z0-9-]+\.)*(huggingface\.co|hf\.co)$/;
  const offAllowlist: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    const local =
      url.protocol === "data:" || url.protocol === "blob:" || url.hostname === "localhost";
    if (!local && !HF_HOST.test(url.hostname)) offAllowlist.push(req.url());
  });

  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("cv-guide.e2e.localModel", "onnx-community/Qwen3-0.6B-ONNX");
  });
  await page.selectOption("#ctx-region", "us");
  await page.setInputFiles('input[type="file"]', PDF_INDIA);
  await page.getByRole("button", { name: /Analyze Résumé/ }).click();
  await page.waitForURL(/\/analyze\//, { timeout: 75_000 });

  await page.getByRole("button", { name: "Generate AI review" }).click();
  await expect(
    page.getByText("AI-enriched").or(page.getByRole("button", { name: "Retry" })),
  ).toBeVisible({ timeout: 900_000 });

  expect(offAllowlist, "AI review must only contact localhost or a named HF host").toEqual([]);
});
