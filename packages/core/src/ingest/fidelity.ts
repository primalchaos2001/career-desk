import type { Finding } from "../finding.js";
import type { PdfExtract, PdfPage } from "./pdf.js";
import { splitSections } from "./sections.js";

/**
 * Parse-fidelity checker (O-02, ARCHITECTURE §7) — Layer 1 of the honest
 * score. Deterministic heuristics over PdfExtract geometry estimating how
 * well ATS parsers will extract this document. Score formula in ADR D-021.
 */

export interface FidelityResult {
  /** 0–100; 100 = nothing that typically breaks resume parsers */
  score: number;
  findings: Finding[];
}

/** x-gap (fraction of page width) between items on one visual line that suggests columns */
const COLUMN_GAP_FRACTION = 0.18;
/** fraction of lines with such a gap for the page to count as multi-column */
const COLUMN_LINE_FRACTION = 0.25;
const LINE_Y_TOLERANCE = 2.5;
const HEADER_FOOTER_BAND = 40;
const FONT_ZOO_THRESHOLD = 5;

/**
 * Detect side-by-side columns: visual lines where one text run ends and the
 * next starts much further right. Reading order of such layouts is parser-
 * dependent — the classic silent killer of two-column resumes.
 */
export function detectMultiColumn(page: PdfPage): boolean {
  const rows: { y: number; items: { start: number; end: number }[] }[] = [];
  for (const item of [...page.items].sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= LINE_Y_TOLERANCE);
    const span = { start: item.x, end: item.x + item.width };
    if (row) row.items.push(span);
    else rows.push({ y: item.y, items: [span] });
  }
  const multiRows = rows.filter((r) => {
    if (r.items.length < 2) return false;
    const sorted = [...r.items].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev && cur && cur.start - prev.end > page.width * COLUMN_GAP_FRACTION) return true;
    }
    return false;
  });
  return rows.length > 0 && multiRows.length / rows.length > COLUMN_LINE_FRACTION;
}

/** identical line text repeated across pages inside the top/bottom bands */
function detectHeaderFooter(extract: PdfExtract): string | null {
  if (extract.pageCount < 2) return null;
  const bandTexts = new Map<string, Set<number>>();
  for (const page of extract.pages) {
    for (const item of page.items) {
      if (item.y > page.height - HEADER_FOOTER_BAND || item.y < HEADER_FOOTER_BAND) {
        const key = item.text.trim();
        if (key.length < 4) continue;
        const set = bandTexts.get(key) ?? new Set<number>();
        set.add(page.pageNumber);
        bandTexts.set(key, set);
      }
    }
  }
  for (const [text, pages] of bandTexts) {
    if (pages.size >= 2) return text;
  }
  return null;
}

export function checkFidelity(extract: PdfExtract): FidelityResult {
  const findings: Finding[] = [];
  let score = 100;

  const multiColumnPages = extract.pages.filter(detectMultiColumn).map((p) => p.pageNumber);
  if (multiColumnPages.length > 0) {
    score -= 35;
    findings.push({
      id: "fid-multi-column",
      layer: "fidelity",
      priority: "P0",
      title: "Multi-column layout detected",
      evidence: `side-by-side text columns on page ${multiColumnPages.join(", ")}`,
      why:
        "Parsers read columns in unpredictable order, scrambling your entries " +
        "into other sections. Single-column layouts parse reliably.",
      source: "fidelity:multi-column",
    });
  }

  const sections = splitSections(extract);
  const recognized = sections.filter((s) => s.name !== null).length;
  if (recognized < 2) {
    score -= 25;
    findings.push({
      id: "fid-unrecognized-sections",
      layer: "fidelity",
      priority: "P0",
      title: "Section headings not recognizable",
      evidence: `only ${recognized} standard section heading(s) found`,
      why:
        "Parsers and recruiters both navigate by standard headings " +
        "(Education, Experience, Projects, Skills). Creative heading names " +
        "leave your content unclassified.",
      source: "fidelity:sections",
    });
  }

  const headerFooterText = detectHeaderFooter(extract);
  if (headerFooterText !== null) {
    score -= 10;
    findings.push({
      id: "fid-header-footer",
      layer: "fidelity",
      priority: "P1",
      title: "Repeated content in header/footer bands",
      evidence: `"${headerFooterText}" repeats at page edges`,
      why:
        "Some parsers skip header/footer regions entirely — contact details " +
        "placed there can vanish from your parsed profile.",
      source: "fidelity:header-footer",
    });
  }

  const imageCount = extract.pages.reduce((n, p) => n + p.imageCount, 0);
  if (imageCount > 0) {
    score -= 5;
    findings.push({
      id: "fid-images",
      layer: "fidelity",
      priority: "P2",
      title: "Images present in the document",
      evidence: `${imageCount} image(s) detected`,
      why:
        "Text inside images is invisible to parsers. Fine for a photo where " +
        "regionally appropriate — never put skills, charts or contact info in images.",
      source: "fidelity:images",
    });
  }

  if (extract.fonts.length > FONT_ZOO_THRESHOLD) {
    score -= 5;
    findings.push({
      id: "fid-font-zoo",
      layer: "fidelity",
      priority: "P2",
      title: "Many different fonts",
      evidence: `${extract.fonts.length} distinct fonts embedded`,
      why:
        "Font variety usually means heavy manual formatting — a signal of " +
        "layout complexity that correlates with parse errors, and it reads " +
        "as visual noise to humans too.",
      source: "fidelity:fonts",
    });
  }

  return { score: Math.max(0, score), findings };
}
