import { type ResumeDoc, ResumeDoc as ResumeDocSchema } from "../resume.js";
import type { PdfExtract } from "./pdf.js";
import { type RawSection, splitSections } from "./sections.js";
import { buildRegionSignals } from "./signals.js";

/**
 * Deterministic PDF → ResumeDoc extraction (D-040). Turns the geometry-based
 * section split (O-01) into a structured résumé WITHOUT an LLM, so a plain PDF
 * upload with no AI key still gets the full per-section scoring (D-039) — the
 * common case that was previously dark. Heuristic and layout-sensitive: it
 * targets standard single-column résumés (bulleted experience/projects,
 * "Category: a, b" skills, degree+GPA education). The LLM path (when a key is
 * present) remains the higher-fidelity extractor; this is the always-available
 * floor. Precision over recall — better a missed bullet than a garbled one.
 */

const BULLET_RE = /^\s*[–—•\-*▪‣●◦·]\s+/;
const isBullet = (l: string): boolean => BULLET_RE.test(l);
const stripBullet = (l: string): string => l.replace(BULLET_RE, "").trim();

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const GPA_RE = /(?:CGPA|GPA|Grade|Score)[:\s]*([\d.]+)\s*\/\s*(\d+(?:\.\d+)?)/i;
const PERCENT_RE = /(\d{2,3}(?:\.\d+)?)\s*%/;
// A trailing date/date-range chunk on an entry header line.
const TRAILING_DATE_RE =
  /\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s*)?\d{4}\s*(?:[–—-]\s*(?:present|current|now|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s*)?\d{4}))?\s*$/i;

const DASH_SPLIT = /\s+[—–]\s+|\s+[-]\s+(?=[A-Z])/;

interface Entry {
  name: string;
  position?: string;
  highlights: string[];
}

/** Split "Left — Right ...date" into its pieces, stripping a trailing date. */
function parseHeader(line: string): { left: string; right: string; rest: string } {
  const noDate = line.replace(TRAILING_DATE_RE, "").trim();
  const parts = noDate.split(DASH_SPLIT);
  const left = (parts[0] ?? noDate).trim();
  const right = parts.length > 1 ? parts.slice(1).join(" — ").trim() : "";
  return { left, right, rest: noDate };
}

const DATE_LINE_RE =
  /^\s*\(?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s*)?\d{4}\s*(?:[–—-]\s*(?:present|current|now|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s*)?\d{4}))?\)?\s*$/i;

function preprocessLines(lines: string[]): string[] {
  const out: string[] = [];
  const inlineBullet = /\s+([•▪‣●◦·*])\s+/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(inlineBullet);
    if (match && match.index !== undefined) {
      const idx = match.index;
      const left = line.slice(0, idx).trim();
      const right = line.slice(idx).trim();
      if (left) out.push(left);
      if (right) out.push(right);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Group a section's lines into entries: header lines start one, bullets attach. */
function parseEntries(lines: string[]): Entry[] {
  const clean = preprocessLines(lines);
  const hasBullets = clean.some(isBullet);
  const entries: Entry[] = [];
  let cur: Entry | null = null;

  for (const line of clean) {
    if (isBullet(line)) {
      if (!cur) cur = { name: "", highlights: [] };
      cur.highlights.push(stripBullet(line));
      continue;
    }

    // Merge date-only lines directly into the active entry
    if (cur && DATE_LINE_RE.test(line)) {
      if (cur.position) {
        cur.position = `${cur.position} ${line}`.trim();
      } else {
        cur.name = `${cur.name} ${line}`.trim();
      }
      continue;
    }

    // Check if this line is a continuation of the active entry/highlight
    const prevText = cur
      ? (cur.highlights[cur.highlights.length - 1] ?? cur.position ?? cur.name)
      : "";

    const isContinuation =
      !/[.?!:●|]$/.test(prevText) &&
      (/^[a-z0-9,;+\-&/()]/.test(line) ||
        /\b(and|or|of|in|for|with|to|a|an|the|by|at|from|on|into)\s*$/i.test(prevText));

    if (cur && isContinuation) {
      if (cur.highlights.length > 0) {
        cur.highlights[cur.highlights.length - 1] =
          `${cur.highlights[cur.highlights.length - 1]} ${line}`.trim();
      } else if (cur.position) {
        cur.position = `${cur.position} ${line}`.trim();
      } else {
        cur.name = `${cur.name} ${line}`.trim();
      }
      continue;
    }

    if (cur) entries.push(cur);
    const { left, right } = parseHeader(line);
    cur = { name: left || line, highlights: [] };
    if (right) cur.position = right;
    // No bullets in this section: the descriptive tail is the one highlight.
    if (!hasBullets && right) cur.highlights = [right];
  }
  if (cur) entries.push(cur);
  return entries.filter((e) => e.name.length > 0 || e.highlights.length > 0);
}

function parseSkills(lines: string[]): ResumeDoc["skills"] {
  const out: ResumeDoc["skills"] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    const line = stripBullet(raw);
    const colon = line.indexOf(":");
    const [nameRaw, listRaw] =
      colon > -1 && colon < 40 ? [line.slice(0, colon), line.slice(colon + 1)] : ["Skills", line];
    const keywords = listRaw
      .split(/[,·|;]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0 && k.length < 40);
    if (keywords.length > 0) out.push({ name: nameRaw.trim() || "Skills", keywords });
  }
  return out;
}

function parseEducation(lines: string[]): ResumeDoc["education"] {
  const out: ResumeDoc["education"] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    const line = stripBullet(raw);
    const { left, right } = parseHeader(line);
    const gpaMatch = line.match(GPA_RE);
    const pctMatch = !gpaMatch ? line.match(PERCENT_RE) : null;
    // institution: prefer the part after "at ", else the right/left piece.
    const atIdx = line.toLowerCase().indexOf(" at ");
    const institution =
      atIdx > -1
        ? line
            .slice(atIdx + 4)
            .replace(/\(.*$/, "")
            .trim()
        : right || left;
    const area = atIdx > -1 ? left.replace(/^\d{4}\s*[–-]\s*\d{4}\s*/, "").trim() : undefined;
    const entry: ResumeDoc["education"][number] = {
      institution: institution || left || "Education",
      courses: [],
      coursework: [],
    };
    if (area) entry.area = area;
    if (gpaMatch?.[1] && gpaMatch[2])
      entry.gpa = { value: Number(gpaMatch[1]), scale: Number(gpaMatch[2]) };
    else if (pctMatch?.[1]) entry.score = `${pctMatch[1]}%`;
    out.push(entry);
  }
  return out;
}

function parseBasics(preamble: RawSection | undefined, summary?: string): ResumeDoc["basics"] {
  const lines = (preamble?.lines ?? []).map((l) => l.trim()).filter(Boolean);
  const name = lines[0] ?? "Unknown";
  const joined = lines.join(" ");
  const email = joined.match(EMAIL_RE)?.[0];
  const phone = joined.match(PHONE_RE)?.[0];
  const lower = joined.toLowerCase();
  const profiles: ResumeDoc["basics"]["profiles"] = [];
  if (lower.includes("github")) profiles.push({ network: "GitHub" });
  if (lower.includes("linkedin")) profiles.push({ network: "LinkedIn" });
  if (lower.includes("portfolio") || lower.includes("website"))
    profiles.push({ network: "Portfolio" });
  return {
    name,
    profiles,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(summary ? { summary } : {}),
  };
}

export function extractResumeDoc(extract: PdfExtract): ResumeDoc {
  const sections = splitSections(extract);
  const regionSignals = buildRegionSignals(extract);
  const byName = (n: string) => sections.filter((s) => s.name === n).flatMap((s) => s.lines);

  const summaryLines = byName("summary");
  const summary = summaryLines.length > 0 ? summaryLines.join(" ").trim() : undefined;

  const work = parseEntries(byName("experience")).map((e) => ({
    name: e.name || e.position || "Experience",
    ...(e.position ? { position: e.position } : {}),
    highlights: e.highlights,
  }));
  const projects = parseEntries(byName("projects")).map((e) => ({
    name: e.name || "Project",
    highlights: e.highlights,
  }));

  return ResumeDocSchema.parse({
    basics: parseBasics(
      sections.find((s) => s.name === null),
      summary,
    ),
    work,
    projects,
    skills: parseSkills(byName("skills")),
    education: parseEducation(byName("education")),
    awards: [],
    certificates: [],
    languages: [],
    meta: { sourceFormat: "pdf", regionSignals },
  });
}
