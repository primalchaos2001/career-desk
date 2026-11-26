import type { PdfExtract, PdfLine } from "./pdf.js";

/**
 * Section splitter (O-01): finds section headings by lexicon + typography and
 * slices the document into raw sections. Output feeds the LLM extraction
 * stage (O-04) — and "no recognizable headings" is itself a fidelity signal
 * for O-02.
 */

export type CanonicalSection =
  | "summary"
  | "education"
  | "experience"
  | "projects"
  | "skills"
  | "awards"
  | "certifications"
  | "publications"
  | "languages"
  | "interests"
  | "personal-details"
  | "declaration"
  | "references";

/**
 * Heading lexicon. Variants are normalized (lowercase, punctuation stripped)
 * before matching. Covers US/UK/India/DE-English resume conventions
 * (docs/RESEARCH.md §4); extend per-region as new region packs land.
 */
const HEADING_LEXICON: Record<CanonicalSection, string[]> = {
  summary: [
    "summary",
    "objective",
    "profile",
    "professional summary",
    "career objective",
    "about",
    "about me",
  ],
  education: [
    "education",
    "academics",
    "academic background",
    "academic details",
    "educational qualifications",
    "educational qualification",
    "qualifications",
    "education and scholastic achievements",
    "scholastic achievements",
    "relevant coursework",
    "coursework",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "work history",
    "internships",
    "internship experience",
    "berufserfahrung",
  ],
  projects: [
    "projects",
    "personal projects",
    "academic projects",
    "key projects",
    "selected projects",
    "technical projects",
    "engineering projects",
    "selected engineering projects",
    "notable projects",
    "featured projects",
  ],
  skills: [
    "skills",
    "technical skills",
    "core competencies",
    "technologies",
    "tools and technologies",
    "skills and interests",
    "technical proficiencies",
    "kenntnisse",
    "technical expertise",
    "skills and tools",
    "skill",
  ],
  awards: [
    "awards",
    "achievements",
    "honors",
    "honours",
    "awards and achievements",
    "achievements and awards",
    "accomplishments",
    "honors and awards",
    "selected honors and awards",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licences",
    "courses and certifications",
  ],
  publications: ["publications", "research", "papers", "research experience"],
  languages: ["languages", "language proficiency", "sprachen"],
  // Positions of Responsibility / organizational / co-curricular experience
  // all describe the same unpaid-leadership bucket in student résumés (D-045);
  // folded into interests, not experience, so club roles don't inflate the
  // paid-work Experience score.
  interests: [
    "interests",
    "hobbies",
    "hobbies and interests",
    "extracurricular activities",
    "extra-curricular activities",
    "extracurriculars",
    "activities",
    "leadership and interests",
    "leadership",
    "positions of responsibility",
    "positions held",
    "organizational experience",
    "co-curricular experience",
    "organizational and co-curricular experience",
    "leadership and activities",
  ],
  "personal-details": [
    "personal details",
    "personal information",
    "personal profile",
    "bio data",
    "persönliche daten",
  ],
  declaration: ["declaration"],
  references: ["references", "referees"],
};

export interface RawSection {
  /** canonical name, or null for content before the first heading (usually the name/contact block) */
  name: CanonicalSection | null;
  /** heading text as it appears in the document ("" for the preamble block) */
  heading: string;
  lines: string[];
  pageNumber: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const VARIANT_TO_SECTION = new Map<string, CanonicalSection>();
for (const [section, variants] of Object.entries(HEADING_LEXICON) as [
  CanonicalSection,
  string[],
][]) {
  for (const v of variants) VARIANT_TO_SECTION.set(v, section);
}

/** Decorative/inline separators PDF extraction sometimes jams onto a heading line (A-14). */
const HEADING_SEPARATORS = /[●|:]/;

/**
 * Lexicon match on normalized text. Some PDF layouts render a heading and its
 * first content on one physical line (e.g. "Achievements ● All India Rank
 * 16…" or "Skills: Python, Java"); when the whole line doesn't match, retry
 * on the text before the first decorative separator. A miss here is just a
 * miss (falls through to null), so this only adds matches, never removes any.
 */
export function matchHeading(text: string): CanonicalSection | null {
  const direct = VARIANT_TO_SECTION.get(normalize(text));
  if (direct) return direct;
  if (HEADING_SEPARATORS.test(text)) {
    const firstPart = text.split(HEADING_SEPARATORS)[0]?.trim();
    if (firstPart) return VARIANT_TO_SECTION.get(normalize(firstPart)) ?? null;
  }
  return null;
}

function isEmphasized(line: PdfLine, bodyFontSize: number): boolean {
  const bolder = line.fontNames.some((f) => /bold|black|heavy|semibold/i.test(f));
  const bigger = line.fontSize > bodyFontSize * 1.05;
  const allCaps = line.text === line.text.toUpperCase() && /[A-Z]/.test(line.text);
  return bolder || bigger || allCaps;
}

/**
 * A line is a heading when its text matches the lexicon AND it looks like a
 * heading typographically (bold/larger/all-caps vs the body font). The
 * typography gate stops body text like "skills in Python" from splitting a
 * section; the lexicon gate stops decorative big text from becoming one.
 */
export function splitSections(extract: PdfExtract): RawSection[] {
  const sizes = extract.lines.map((l) => l.fontSize).sort((a, b) => a - b);
  const bodyFontSize = sizes[Math.floor(sizes.length / 2)] ?? 10;

  const sections: RawSection[] = [];
  let current: RawSection = { name: null, heading: "", lines: [], pageNumber: 1 };

  for (const line of extract.lines) {
    const matched = matchHeading(line.text);
    if (matched !== null && isEmphasized(line, bodyFontSize)) {
      if (current.lines.length > 0 || current.heading !== "") sections.push(current);
      current = { name: matched, heading: line.text, lines: [], pageNumber: line.pageNumber };
    } else {
      current.lines.push(line.text);
    }
  }
  sections.push(current);
  return sections;
}
