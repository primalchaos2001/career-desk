import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PdfExtract } from "../src/ingest/pdf.js";
import { extractPdf } from "../src/ingest/pdf.js";
import { extractResumeDoc } from "../src/ingest/pdf-doc.js";

/**
 * D-040: deterministic PDF → ResumeDoc (no LLM). Drives the real fixture PDFs so
 * a plain PDF upload with no AI key produces structured content the D-039
 * scorer can grade.
 */

const pdf = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url))));

describe("extractResumeDoc (deterministic PDF extraction)", () => {
  it("pulls structured content out of a standard résumé PDF, no LLM", async () => {
    const doc = extractResumeDoc(await extractPdf(pdf("india-fresher.pdf")));
    // Name + section content the scorer needs.
    expect(doc.basics.name).toBe("Rohan Gupta");
    expect(doc.basics.email).toContain("@");
    expect(doc.education.length).toBeGreaterThan(0);
    expect(doc.education[0]?.gpa?.value).toBeCloseTo(8.6, 1);
    expect(doc.skills.flatMap((s) => s.keywords)).toEqual(
      expect.arrayContaining(["Java", "Python", "MySQL"]),
    );
    expect(doc.projects.length).toBeGreaterThan(0);
    expect(doc.projects[0]?.highlights.length).toBeGreaterThan(0);
  });

  it("attaches bulleted lines as highlights of their entry", async () => {
    // us-clean is a minimal single-line fixture; assert it parses without throwing
    // and yields a valid doc (schema-parsed) — the scorer can then run.
    const doc = extractResumeDoc(await extractPdf(pdf("us-clean.pdf")));
    expect(doc.basics.name.length).toBeGreaterThan(0);
    expect(doc.meta.sourceFormat).toBe("pdf");
  });

  it("extracts structured content from an engineering CV (dv-engineer-sample.pdf)", async () => {
    const doc = extractResumeDoc(await extractPdf(pdf("dv-engineer-sample.pdf")));
    expect(doc.basics.name).toContain("PRIYA SHARMA");
    expect(doc.basics.email).toBe("priya.sharma@example.com");
    expect(doc.basics.phone).toBe("9000000001");
    expect(doc.education.length).toBeGreaterThan(0);
    expect(doc.skills.length).toBeGreaterThan(0);
    expect(doc.projects.length).toBeGreaterThan(0);
    expect(doc.work.length).toBeGreaterThan(0);
    expect(doc.meta.sourceFormat).toBe("pdf");
    expect(doc.meta.regionSignals.hasPhoto).toBe(true);
  });

  it("joins wrapped project header lines and bullets correctly", () => {
    const mockExtract: PdfExtract = {
      pageCount: 1,
      pages: [],
      fonts: [],
      fullText: "",
      lines: [
        { pageNumber: 1, y: 100, text: "PROJECTS", fontSize: 12, fontNames: ["bold"] },
        {
          pageNumber: 1,
          y: 80,
          text: "FPGA-Based Ultrasound Imaging Using Delay and",
          fontSize: 10,
          fontNames: ["bold"],
        },
        {
          pageNumber: 1,
          y: 70,
          text: "sum beamforming algorithm",
          fontSize: 10,
          fontNames: ["regular"],
        },
        {
          pageNumber: 1,
          y: 60,
          text: "● Developed DAS core and and",
          fontSize: 10,
          fontNames: ["regular"],
        },
        {
          pageNumber: 1,
          y: 50,
          text: "integrated it on FPGA",
          fontSize: 10,
          fontNames: ["regular"],
        },
      ],
    };
    const doc = extractResumeDoc(mockExtract);
    expect(doc.projects.length).toBe(1);
    expect(doc.projects[0]?.name).toBe(
      "FPGA-Based Ultrasound Imaging Using Delay and sum beamforming algorithm",
    );
    expect(doc.projects[0]?.highlights).toEqual([
      "Developed DAS core and and integrated it on FPGA",
    ]);
  });
});
