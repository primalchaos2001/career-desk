import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdf } from "../src/ingest/pdf.js";
import { matchHeading, splitSections } from "../src/ingest/sections.js";
import {
  buildRegionSignals,
  detectDateOfBirth,
  detectDeclarationLine,
  detectMaritalStatus,
  detectNationality,
  detectSpellingVariant,
} from "../src/ingest/signals.js";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf", name)));

describe("extractPdf", () => {
  it("extracts pages, lines, fonts and images from a clean US resume", async () => {
    const extract = await extractPdf(fixture("us-clean.pdf"));
    expect(extract.pageCount).toBe(1);
    expect(extract.pages[0]?.imageCount).toBe(0);
    expect(extract.fonts.length).toBeGreaterThanOrEqual(2);
    expect(extract.fullText).toContain("Avery Chen");
    expect(extract.fullText).toContain("reducing p95 latency 40%");
  });

  it("counts images and pages on a photo resume", async () => {
    const extract = await extractPdf(fixture("india-fresher.pdf"));
    expect(extract.pageCount).toBe(2);
    expect(extract.pages[0]?.imageCount).toBeGreaterThan(0);
  });
});

describe("region signals from PDFs", () => {
  it("us-clean: no photo, no personal details, en-US, 1 page", async () => {
    const signals = buildRegionSignals(await extractPdf(fixture("us-clean.pdf")));
    expect(signals).toMatchObject({
      hasPhoto: false,
      hasDateOfBirth: false,
      hasMaritalStatus: false,
      hasNationality: false,
      hasDeclarationLine: false,
      spellingVariant: "en-US",
      pageCount: 1,
    });
  });

  it("india-fresher: photo, DOB, nationality, declaration, en-GB, 2 pages", async () => {
    const signals = buildRegionSignals(await extractPdf(fixture("india-fresher.pdf")));
    expect(signals).toMatchObject({
      hasPhoto: true,
      hasDateOfBirth: true,
      hasNationality: true,
      hasDeclarationLine: true,
      spellingVariant: "en-GB",
      pageCount: 2,
    });
  });

  it("de-lebenslauf: photo, Geburtsdatum, Familienstand", async () => {
    const signals = buildRegionSignals(await extractPdf(fixture("de-lebenslauf.pdf")));
    expect(signals).toMatchObject({
      hasPhoto: true,
      hasDateOfBirth: true,
      hasMaritalStatus: true,
      pageCount: 1,
    });
  });
});

describe("splitSections", () => {
  it("finds the canonical sections of the US resume with a preamble block", async () => {
    const sections = splitSections(await extractPdf(fixture("us-clean.pdf")));
    expect(sections[0]?.name).toBeNull();
    expect(sections[0]?.lines.join(" ")).toContain("Avery Chen");
    expect(sections.map((s) => s.name)).toEqual([
      null,
      "education",
      "experience",
      "projects",
      "skills",
    ]);
    const education = sections.find((s) => s.name === "education");
    expect(education?.lines.join(" ")).toContain("GPA 3.7/4.0");
  });

  it("handles Indian and German section names across pages", async () => {
    const india = splitSections(await extractPdf(fixture("india-fresher.pdf")));
    expect(india.map((s) => s.name)).toEqual([
      null,
      "personal-details",
      "education",
      "projects",
      "skills",
      "declaration",
    ]);
    const de = splitSections(await extractPdf(fixture("de-lebenslauf.pdf")));
    expect(de.map((s) => s.name)).toContain("personal-details");
  });
});

describe("signal detectors (unit)", () => {
  it("spelling variant", () => {
    expect(detectSpellingVariant("optimised the colour scheme")).toBe("en-GB");
    expect(detectSpellingVariant("optimized the color scheme")).toBe("en-US");
    expect(detectSpellingVariant("optimised then optimized")).toBe("mixed");
    expect(detectSpellingVariant("built a web app")).toBe("unknown");
    // "program" is deliberately not a marker (ambiguous in CS resumes)
    expect(detectSpellingVariant("wrote a program")).toBe("unknown");
  });

  it("personal-detail patterns", () => {
    expect(detectDateOfBirth("Date of Birth: 14/03/2003")).toBe(true);
    expect(detectDateOfBirth("DOB: 2003-03-14")).toBe(true);
    expect(detectDateOfBirth("Geburtsdatum: 01.01.2002")).toBe(true);
    expect(detectDateOfBirth("stubborn debugging session")).toBe(false);
    expect(detectMaritalStatus("Familienstand: ledig")).toBe(true);
    expect(detectMaritalStatus("worked in a single team")).toBe(false);
    expect(detectNationality("Nationality: Indian")).toBe(true);
    expect(detectNationality("national hackathon winner")).toBe(false);
    expect(detectDeclarationLine("I hereby declare that the above is true")).toBe(true);
    expect(detectDeclarationLine("declared variables in scope")).toBe(false);
  });

  it("heading lexicon matches variants and rejects body text", () => {
    expect(matchHeading("TECHNICAL SKILLS")).toBe("skills");
    expect(matchHeading("Work Experience")).toBe("experience");
    expect(matchHeading("Persönliche Daten")).toBe("personal-details");
    expect(matchHeading("skills in Python and Go")).toBeNull();
  });
});
