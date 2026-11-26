import { z } from "zod";

/**
 * Canonical resume model: JSON Resume (https://jsonresume.org/schema/) plus
 * TailorATS extensions (docs/ARCHITECTURE.md §3). Every pipeline stage speaks
 * ResumeDoc (ADR D-003, reaffirmed by D-011 with zod replacing Pydantic).
 *
 * Dates are loose ISO-8601 strings per JSON Resume convention ("2024", "2024-06",
 * "2024-06-01"); consistency of formatting is a rule-pack concern, not a schema one.
 */
const isoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "expected YYYY[-MM[-DD]]");

export const Location = z.object({
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  countryCode: z.string().optional(),
  region: z.string().optional(),
});

export const Profile = z.object({
  network: z.string(),
  username: z.string().optional(),
  url: z.string().optional(),
});

export const Basics = z.object({
  name: z.string(),
  label: z.string().optional(),
  image: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  summary: z.string().optional(),
  location: Location.optional(),
  profiles: z.array(Profile).default([]),
});

export const Work = z.object({
  name: z.string(),
  position: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).default([]),
});

export const Gpa = z.object({
  value: z.number(),
  scale: z.number(),
});

export const Education = z.object({
  institution: z.string(),
  url: z.string().optional(),
  area: z.string().optional(),
  studyType: z.string().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  score: z.string().optional(),
  courses: z.array(z.string()).default([]),
  /** extension: structured GPA enables "GPA missing/should be prominent" rules */
  gpa: Gpa.optional(),
  /** extension: relevant coursework, distinct from formal courses taken */
  coursework: z.array(z.string()).default([]),
});

export const Skill = z.object({
  name: z.string(),
  level: z.string().optional(),
  keywords: z.array(z.string()).default([]),
});

export const ProjectEnrichment = z.object({
  stars: z.number().optional(),
  candidateCommits: z.number().optional(),
  totalCommits: z.number().optional(),
  languages: z.array(z.string()).default([]),
  lastActivity: isoDate.optional(),
});

export const Project = z.object({
  name: z.string(),
  description: z.string().optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  url: z.string().optional(),
  roles: z.array(z.string()).default([]),
  /** extension: enables GitHub enrichment + "link your code" rules */
  githubUrl: z.string().optional(),
  /** extension: filled by the (optional) GitHub enrichment stage */
  enrichment: ProjectEnrichment.optional(),
});

export const Award = z.object({
  title: z.string(),
  date: isoDate.optional(),
  awarder: z.string().optional(),
  summary: z.string().optional(),
});

export const Certificate = z.object({
  name: z.string(),
  date: isoDate.optional(),
  issuer: z.string().optional(),
  url: z.string().optional(),
});

export const LanguageItem = z.object({
  language: z.string(),
  fluency: z.string().optional(),
});

export const SourceFormat = z.enum(["pdf", "tex", "docx", "builder"]);

export const SpellingVariant = z.enum(["en-US", "en-GB", "mixed", "unknown"]);

/**
 * Signals detected at ingest that regional rule packs consume
 * (photo on US resume, DOB in EU, declaration line outside India, ...).
 */
export const RegionSignals = z.object({
  hasPhoto: z.boolean().default(false),
  hasDateOfBirth: z.boolean().default(false),
  hasMaritalStatus: z.boolean().default(false),
  hasNationality: z.boolean().default(false),
  hasDeclarationLine: z.boolean().default(false),
  spellingVariant: SpellingVariant.default("unknown"),
  pageCount: z.number().int().positive().optional(),
});

/** Maps a logical section to line ranges in uploaded .tex source (enables Apply-fix). */
export const TexSourceRange = z.object({
  section: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
});

export const ResumeMeta = z.object({
  sourceFormat: SourceFormat,
  texSourceMap: z.array(TexSourceRange).default([]),
  regionSignals: RegionSignals.default(() => RegionSignals.parse({})),
});

export const ResumeDoc = z.object({
  basics: Basics,
  work: z.array(Work).default([]),
  education: z.array(Education).default([]),
  skills: z.array(Skill).default([]),
  projects: z.array(Project).default([]),
  awards: z.array(Award).default([]),
  certificates: z.array(Certificate).default([]),
  languages: z.array(LanguageItem).default([]),
  meta: ResumeMeta,
});

export type Location = z.infer<typeof Location>;
export type Profile = z.infer<typeof Profile>;
export type Basics = z.infer<typeof Basics>;
export type Work = z.infer<typeof Work>;
export type Gpa = z.infer<typeof Gpa>;
export type Education = z.infer<typeof Education>;
export type Skill = z.infer<typeof Skill>;
export type ProjectEnrichment = z.infer<typeof ProjectEnrichment>;
export type Project = z.infer<typeof Project>;
export type Award = z.infer<typeof Award>;
export type Certificate = z.infer<typeof Certificate>;
export type LanguageItem = z.infer<typeof LanguageItem>;
export type SourceFormat = z.infer<typeof SourceFormat>;
export type SpellingVariant = z.infer<typeof SpellingVariant>;
export type RegionSignals = z.infer<typeof RegionSignals>;
export type TexSourceRange = z.infer<typeof TexSourceRange>;
export type ResumeMeta = z.infer<typeof ResumeMeta>;
export type ResumeDoc = z.infer<typeof ResumeDoc>;
