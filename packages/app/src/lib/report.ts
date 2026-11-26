export type Priority = "P0" | "P1" | "P2";
export type Layer = "fidelity" | "findability" | "impact" | "context";
export type ResumeSection =
  | "contact"
  | "experience"
  | "projects"
  | "skills"
  | "education"
  | "format";
export type Region = "us" | "india" | "uk" | "de";
// Values match packages/rules/rulepacks/role/<x>.yaml exactly (role/${Role}) —
// keep it that way so a new role pack needs no separate translation table.
export type Role =
  | "swe-intern"
  | "data-analyst"
  | "finance-analyst"
  | "ib-analyst"
  | "mech-engineer-intern"
  | "ee-intern"
  | "consulting-analyst"
  | "dv-engineer"
  | "mba-applicant";
export type Industry = "tech" | "finance" | "consulting" | "engineering" | "healthcare" | "other";
// Career progression only — NOT a target-audience/credential choice. An MBA
// framing is a Role (`mba-applicant`, landed with A-17/D-053), since
// someone at any of these stages can apply MBA-framed (D-043, corrected).
export type Stage = "student" | "new-grad" | "early-career";

export interface Suggestion {
  before?: string;
  after?: string;
}

export interface Finding {
  id: string;
  layer: Layer;
  priority: Priority;
  title: string;
  evidence: string;
  why: string;
  source: string;
  section?: ResumeSection;
  suggestion?: Suggestion;
  applied?: boolean;
  verdict?: "up" | "down" | "na" | null;
  reason?: string;
  /** on-device AI enriched this finding's why/suggestion (D-056/O-20) — distinct from source: "llm" (D-057) */
  enriched?: boolean;
}

/** Order sections appear in the report, with display labels (D-039). */
export const SECTION_ORDER: ResumeSection[] = [
  "contact",
  "experience",
  "projects",
  "skills",
  "education",
  "format",
];

export const SECTION_LABELS: Record<ResumeSection, string> = {
  contact: "Contact & Links",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
  format: "Format & Parsing",
};

export interface ContextUsed {
  region: Region;
  role: Role;
  industry?: Industry;
  stage: Stage;
  jobDescriptionProvided: boolean;
}

/** Per-section strengths/gaps/benchmark read (D-042) — one per key in `sections`. */
export interface SectionReadout {
  section: ResumeSection;
  score: number;
  strengths: string[];
  gaps: string[];
  benchmark: string;
}

export interface Report {
  id: string;
  filename: string;
  createdAt: string; // ISO
  // The headline number and per-section sub-scores from the deterministic
  // engine (D-039); present whenever there was résumé content to score.
  overall?: number;
  sections?: Partial<Record<ResumeSection, number>>;
  // Per-section strengths/gaps/benchmark reads (D-042), same presence rule as `sections`.
  readouts?: SectionReadout[];
  // Analytical-layer scores (the "why" behind the sections). Partial: a
  // content-less degraded PDF may carry fidelity only.
  scores: { fidelity?: number; findability?: number; impact?: number };
  findings: Finding[];
  contextUsed: ContextUsed;
}

export interface AnalyzeInput {
  filename: string;
  resumeText: string;
  region: Region;
  role: Role;
  industry?: Industry;
  stage: Stage;
  jobDescription?: string;
}

export const REGION_LABELS: Record<Region, string> = {
  us: "United States",
  india: "India",
  uk: "United Kingdom",
  de: "Germany",
};

export const ROLE_LABELS: Record<Role, string> = {
  "swe-intern": "Software Engineer Intern",
  "data-analyst": "Data Analyst",
  "finance-analyst": "Finance Analyst",
  "ib-analyst": "Investment Banking Analyst",
  "mech-engineer-intern": "Mechanical Engineer Intern",
  "ee-intern": "Electrical Engineer Intern",
  "consulting-analyst": "Consulting Analyst",
  "dv-engineer": "Design & Verification / VLSI Engineer",
  "mba-applicant": "MBA Applicant",
};

export const INDUSTRY_LABELS: Record<Industry, string> = {
  tech: "Tech",
  finance: "Finance",
  consulting: "Consulting",
  engineering: "Engineering / Hardware",
  healthcare: "Healthcare",
  other: "Other",
};

export const STAGE_LABELS: Record<Stage, string> = {
  student: "Student",
  "new-grad": "New Graduate",
  "early-career": "Early Career (0–2 years)",
};
