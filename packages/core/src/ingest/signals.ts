import type { RegionSignals, SpellingVariant } from "../resume.js";
import type { PdfExtract } from "./pdf.js";

/**
 * Deterministic region-signal detection (O-01). These populate
 * `meta.regionSignals`, which the region rule packs consume (us-no-photo,
 * us-no-personal-details, in-two-pages, ...). Pure text/geometry heuristics —
 * no LLM. Lexicons cover English plus common Indian and German resume
 * phrasings (docs/RESEARCH.md §4).
 */

/** One-way spelling markers: each word is distinctive of exactly one variant. */
const GB_MARKERS = [
  "optimise",
  "optimised",
  "organise",
  "organised",
  "analyse",
  "analysed",
  "colour",
  "behaviour",
  "favourite",
  "utilise",
  "utilised",
  "licence",
  "centre",
  "honours",
  "labelled",
  "modelling",
  "travelled",
  "specialise",
  "specialised",
  "programme",
];

const US_MARKERS = [
  "optimize",
  "optimized",
  "organize",
  "organized",
  "analyze",
  "analyzed",
  "color",
  "behavior",
  "favorite",
  "utilize",
  "utilized",
  "center",
  "honors",
  "labeled",
  "modeling",
  "traveled",
  "specialize",
  "specialized",
];

function countMarkers(text: string, markers: string[]): number {
  let count = 0;
  for (const marker of markers) {
    if (new RegExp(`\\b${marker}\\b`, "i").test(text)) count++;
  }
  return count;
}

export function detectSpellingVariant(text: string): SpellingVariant {
  const gb = countMarkers(text, GB_MARKERS);
  const us = countMarkers(text, US_MARKERS);
  if (gb > 0 && us > 0) return "mixed";
  if (gb > 0) return "en-GB";
  if (us > 0) return "en-US";
  return "unknown";
}

/** "Date of Birth: ...", "DOB - ...", "Geburtsdatum ...", "Born: ..." */
const DOB_PATTERN =
  /\b(date\s+of\s+birth|d\.?\s?o\.?\s?b\.?\s*[:\-–]|birth\s?date|geburtsdatum|born\s*[:\-–])/i;

/** "Marital Status: Single", "Familienstand: ledig", "Married" as a labeled fact */
const MARITAL_PATTERN = /\b(marital\s+status|familienstand|married|unmarried)\b/i;

/** "Nationality: Indian", "Citizenship: ...", "Staatsangehörigkeit" */
const NATIONALITY_PATTERN = /\b(nationality\s*[:\-–]|citizenship\s*[:\-–]|staatsangehörigkeit)/i;

/** "I hereby declare that..." / a "Declaration" section heading */
const DECLARATION_PATTERN = /\b(i\s+hereby\s+declare|declaration)\b/i;

export function detectDateOfBirth(text: string): boolean {
  return DOB_PATTERN.test(text);
}

export function detectMaritalStatus(text: string): boolean {
  return MARITAL_PATTERN.test(text);
}

export function detectNationality(text: string): boolean {
  return NATIONALITY_PATTERN.test(text);
}

export function detectDeclarationLine(text: string): boolean {
  return DECLARATION_PATTERN.test(text);
}

/**
 * Photo heuristic: any image painted on page 1. Resume photos are page-1
 * artifacts; logos/icons also match, which is acceptable for now — a false
 * "has photo" on a US resume surfaces a P0 the user can dismiss, and the
 * fidelity layer (O-02) will refine this with image geometry.
 */
export function detectPhoto(extract: Pick<PdfExtract, "pages">): boolean {
  return (extract.pages[0]?.imageCount ?? 0) > 0;
}

/** Assemble the full RegionSignals block from a PdfExtract. */
export function buildRegionSignals(extract: PdfExtract): RegionSignals {
  return {
    hasPhoto: detectPhoto(extract),
    hasDateOfBirth: detectDateOfBirth(extract.fullText),
    hasMaritalStatus: detectMaritalStatus(extract.fullText),
    hasNationality: detectNationality(extract.fullText),
    hasDeclarationLine: detectDeclarationLine(extract.fullText),
    spellingVariant: detectSpellingVariant(extract.fullText),
    pageCount: extract.pageCount,
  };
}
