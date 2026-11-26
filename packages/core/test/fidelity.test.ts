import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Finding } from "../src/finding.js";
import { checkFidelity, detectMultiColumn } from "../src/ingest/fidelity.js";
import { extractPdf } from "../src/ingest/pdf.js";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf", name)));

describe("checkFidelity", () => {
  it("gives a clean single-column resume a high score with no findings", async () => {
    const { score, findings } = checkFidelity(await extractPdf(fixture("us-clean.pdf")));
    expect(score).toBe(100);
    expect(findings).toHaveLength(0);
  });

  it("penalizes a two-column layout visibly (P0 finding)", async () => {
    const extract = await extractPdf(fixture("two-column.pdf"));
    expect(extract.pages.some(detectMultiColumn)).toBe(true);
    const { score, findings } = checkFidelity(extract);
    expect(findings.map((f) => f.id)).toContain("fid-multi-column");
    expect(score).toBeLessThanOrEqual(65);
  });

  it("flags unrecognizable headings, images and font zoo on a designer resume", async () => {
    const { score, findings } = checkFidelity(await extractPdf(fixture("artsy-no-headings.pdf")));
    const ids = findings.map((f) => f.id);
    expect(ids).toContain("fid-unrecognized-sections");
    expect(ids).toContain("fid-images");
    expect(ids).toContain("fid-font-zoo");
    expect(score).toBeLessThanOrEqual(65);
  });

  it("does not flag single-column resumes with a photo as multi-column", async () => {
    const extract = await extractPdf(fixture("india-fresher.pdf"));
    const { findings } = checkFidelity(extract);
    expect(findings.map((f) => f.id)).not.toContain("fid-multi-column");
  });

  it("emits schema-valid findings with fidelity provenance", async () => {
    const { findings } = checkFidelity(await extractPdf(fixture("artsy-no-headings.pdf")));
    for (const finding of findings) {
      expect(() => Finding.parse(finding)).not.toThrow();
      expect(finding.layer).toBe("fidelity");
      expect(finding.source).toMatch(/^fidelity:/);
    }
  });
});
