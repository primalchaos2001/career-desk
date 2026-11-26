/**
 * PDF extraction (O-01). Produces the intermediate
 * `PdfExtract` that region-signal detection (signals.ts), section splitting
 * (sections.ts), and the Phase-1 fidelity checker (O-02) consume.
 *
 * Uses pdfjs-dist's legacy build so the same code runs in Node (tests, CLI)
 * and the browser (Web Worker) — the app configures a real worker later;
 * under Node pdf.js falls back to its "fake worker" transparently.
 */

export interface PdfTextItem {
  text: string;
  /** PDF user-space coords; origin bottom-left, y grows upward */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
}

export interface PdfPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  /** image XObjects painted on this page (photos, logos, icons) */
  imageCount: number;
}

export interface PdfLine {
  pageNumber: number;
  y: number;
  text: string;
  /** dominant (max) font size on the line */
  fontSize: number;
  fontNames: string[];
}

export interface PdfExtract {
  pageCount: number;
  pages: PdfPage[];
  /** distinct font names used across the document */
  fonts: string[];
  /** visual lines in reading order (top→bottom per page) */
  lines: PdfLine[];
  /** whole document as plain text, one visual line per \n */
  fullText: string;
}

/** y-distance (in text units) within which two items count as one line */
const LINE_Y_TOLERANCE = 2.5;

/**
 * Browsers require pdf.js to be told where its worker lives; Node silently
 * falls back to a main-thread fake worker, which is why omitting this only
 * fails in a real browser (D-033). Passed explicitly rather than held in a
 * module singleton — workspace packages can be bundled into separate module
 * instances, so a singleton silently reads back null.
 *
 * With Vite:
 *   import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker";
 *   extractPdf(bytes, { workerPort: new PdfWorker() });
 *
 * Bundler-agnostic on purpose: core never imports a worker URL itself.
 */
export interface PdfWorkerConfig {
  workerSrc?: string;
  workerPort?: Worker;
}

export async function extractPdf(data: Uint8Array, worker?: PdfWorkerConfig): Promise<PdfExtract> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (worker?.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = worker.workerPort;
  } else if (worker?.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.workerSrc;
  }
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  const fonts = new Set<string>();

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [a, b, , , e, f] = item.transform as number[];
      const fontSize = Math.hypot(a ?? 0, b ?? 0);
      // raw resource name (distinct per embedded font, unlike styles[].fontFamily
      // which collapses everything to generic families)
      const fontName = item.fontName;
      fonts.add(fontName);
      items.push({
        text: item.str,
        x: e ?? 0,
        y: f ?? 0,
        width: item.width,
        height: item.height,
        fontName,
        fontSize,
      });
    }

    const ops = await page.getOperatorList();
    let imageCount = 0;
    for (const fn of ops.fnArray) {
      if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        imageCount++;
      }
    }

    pages.push({
      pageNumber: n,
      width: viewport.width,
      height: viewport.height,
      items,
      imageCount,
    });
  }
  await loadingTask.destroy();

  const lines = pages.flatMap(groupIntoLines);
  return {
    pageCount: pages.length,
    pages,
    fonts: [...fonts].sort(),
    lines,
    fullText: lines.map((l) => l.text).join("\n"),
  };
}

/** Group a page's text items into visual lines by y proximity, then order by x. */
export function groupIntoLines(page: PdfPage): PdfLine[] {
  const sorted = [...page.items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: { y: number; items: PdfTextItem[] }[] = [];

  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= LINE_Y_TOLERANCE) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines.map(({ y, items }) => {
    const inReadingOrder = [...items].sort((p, q) => p.x - q.x);
    return {
      pageNumber: page.pageNumber,
      y,
      text: inReadingOrder
        .map((i) => i.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      fontSize: Math.max(...items.map((i) => i.fontSize)),
      fontNames: [...new Set(items.map((i) => i.fontName))],
    };
  });
}
