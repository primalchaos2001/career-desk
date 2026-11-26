import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { resetWorkspaceFolder } from "./folder";

test.use({ actionTimeout: 10_000 });
// The server keeps the workspace in one folder for all tests; start each test empty.
test.beforeEach(() => resetWorkspaceFolder());

async function nav(page: Page, name: string) {
  await page.locator(".cd-menu").waitFor({ state: "attached" });
  if (await page.locator(".cd-menu").isVisible()) await page.locator(".cd-menu").click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name })
    .click();
}
async function profile(page: Page) {
  await nav(page, "My profile");
  await page.getByLabel("Full name").fill("Asha Sharma");
  await page.getByLabel("Email", { exact: true }).fill("asha@example.com");
  await page
    .getByLabel("Experience summary")
    .fill("Led customer research for a student consulting project.");
  await page.getByLabel("Skills", { exact: true }).fill("Research, Strategy");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved", { exact: true }).first()).toBeVisible();
}
async function campaign(page: Page, name = "Consulting in Mumbai") {
  await nav(page, "Campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByLabel("Campaign name").fill(name);
  await page.getByLabel("Target job titles").fill("Consultant");
  await page.getByLabel("Preferred locations").fill("Mumbai");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function job(page: Page) {
  await nav(page, "Opportunities");
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await page.getByLabel("Job title", { exact: true }).fill("Strategy Consultant");
  await page.getByLabel("Company / organisation").fill("Example Consulting");
  await page.getByLabel("Job URL").fill("https://example.com/careers/consultant?id=42");
  await page.getByLabel("Location / work mode").fill("Mumbai · Hybrid");
  await page
    .getByLabel("Full job description")
    .fill("Research and strategy work for consulting engagements.");
  await page.getByRole("button", { name: "Save opportunity", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("profile -> two campaigns -> job -> document snapshot -> confirmed status -> session -> backup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Make your next move count." })).toBeVisible();
  await profile(page);
  await campaign(page);
  await campaign(page, "Product exploration");
  await job(page);
  await page.getByRole("button", { name: "Prepare application" }).click();
  await expect(page.getByLabel("Application document")).toHaveValue(/Led customer research/);
  await page.getByLabel("Application status").selectOption("applied");
  await page.getByRole("button", { name: "Save application", exact: true }).click();
  await expect(page.getByText(/Add a confirmation reference/)).toBeVisible();
  await page
    .getByLabel("Confirmation / outcome reference")
    .fill("Employer confirmation reference 42");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print / PDF" }).click();
  const print = await popup;
  await expect(print.getByText("Led customer research", { exact: false })).toBeVisible();
  await print.close();
  await page.getByRole("button", { name: "Save application", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Applications");
  await expect(page.getByRole("cell", { name: "Applied", exact: true })).toBeVisible();
  await nav(page, "Work sessions");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByLabel("Session title").fill("First research pass");
  await page.getByLabel("Working with").selectOption("codex");
  await page.getByLabel("Next action").fill("Verify three boutique consulting openings");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("Verify three boutique consulting openings", { exact: true }),
  ).toBeVisible();
  await nav(page, "Assistants & backup");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export assistant workspace" }).click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe("career-desk-workspace.zip");
  const path = await zip.path();
  if (!path) throw new Error("Missing download");
  await page.getByLabel("Choose workspace file").setInputFiles(path);
  await expect(page.getByRole("heading", { name: "Review incoming workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("Workspace imported", { exact: true })).toBeVisible();
  await nav(page, "Overview");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.screenshot({ path: "test-results/career-desk-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("profile PDF import reuses ATS extraction and survives reload", async ({ page }) => {
  await page.goto("/workspace#profile");
  const file = fileURLToPath(
    new URL("../../core/test/fixtures/pdf/india-fresher.pdf", import.meta.url),
  );
  await page.getByLabel("Choose CV file").setInputFiles(file);
  await expect(page.getByText(/CV loaded/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Full name")).not.toHaveValue("");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("india-fresher.pdf", { exact: false }).first()).toBeVisible();
});

test("jobs are isolated per campaign and deduplicated across campaigns", async ({ page }) => {
  await page.goto("/workspace");
  await campaign(page, "Consulting");
  await job(page);
  await campaign(page, "Psychology");
  await nav(page, "Opportunities");
  await expect(page.getByRole("heading", { name: "Strategy Consultant", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "All campaigns", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Strategy Consultant", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await page.getByLabel("Job title", { exact: true }).fill("Duplicate");
  await page.getByLabel("Company / organisation").fill("Example Consulting");
  await page
    .getByLabel("Job URL")
    .fill("https://example.com/careers/consultant?id=42&utm_source=another");
  await page.getByRole("button", { name: "Save opportunity", exact: true }).click();
  await expect(page.getByText(/already saved/)).toBeVisible();
});

test("mobile navigation and forms fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");
  await profile(page);
  await campaign(page);
  await nav(page, "Overview");
  await expect(page.getByRole("heading", { name: "Make your next move count." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/career-desk-mobile.png", fullPage: true });
});

test("stale tabs cannot overwrite newer profile edits", async ({ page, context }) => {
  await page.goto("/workspace");
  await profile(page);
  const other = await context.newPage();
  await other.goto("/workspace#profile");
  // The other tab must have loaded the old profile before this tab changes it.
  await expect(other.getByLabel("Full name")).toHaveValue("Asha Sharma");
  await nav(page, "My profile");
  await page.getByLabel("Full name").fill("Asha Updated");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved", { exact: true }).first()).toBeVisible();
  await other.getByLabel("Full name").fill("Old tab edit");
  await other.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(other.getByText(/changed in another tab/)).toBeVisible();
  await other.reload();
  await expect(other.getByLabel("Full name")).toHaveValue("Asha Updated");
});

test("CSV imports are reviewed, deduplicated, and atomic on invalid rows", async ({ page }) => {
  await page.goto("/workspace");
  await campaign(page);
  await nav(page, "Opportunities");
  const csv =
    "title,company,url,description\nConsultant,Sample Firm,https://example.com/job/one,Research\nConsultant,Sample Firm,https://example.com/job/one?utm_source=another,Research";
  await page
    .getByLabel("Import CSV / JSON")
    .setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import opportunities", exact: true }).click();
  await expect(
    page.getByText("Imported 1 jobs; skipped 1 duplicates", { exact: true }),
  ).toBeVisible();
  const invalid =
    "title,company,url\nAnother role,Firm,https://example.com/two\nBad URL,Firm,javascript:alert(1)";
  await page
    .getByLabel("Import CSV / JSON")
    .setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(invalid) });
  await page.getByRole("button", { name: "Import opportunities", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("heading", { name: "Another role", exact: true })).toHaveCount(0);
});

test("templates can be edited and reused without rewriting earlier applications", async ({
  page,
}) => {
  await page.goto("/workspace");
  await profile(page);
  await campaign(page);
  await job(page);
  await page.getByRole("button", { name: "Prepare application" }).click();
  const original = await page.getByLabel("Application document").inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await nav(page, "Templates");
  await page.getByLabel("Template text").fill("Hello {{company}}, I am {{name}}. {{summary}}");
  // Starter templates are saved as "my wording" (D-079).
  await page.getByRole("button", { name: "Save as my wording", exact: true }).click();
  await expect(page.getByText("Template saved", { exact: true })).toBeVisible();
  await nav(page, "Applications");
  await page.getByRole("button", { name: "Review", exact: false }).click();
  await expect(page.getByLabel("Application document")).toHaveValue(original);
});

test("research-only campaigns cannot prepare application documents", async ({ page }) => {
  await page.goto("/workspace");
  await profile(page);
  await campaign(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Assistant permissions").selectOption("research");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await job(page);
  await page.getByRole("button", { name: "Prepare application" }).click();
  await expect(page.getByText(/This campaign is research only/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
