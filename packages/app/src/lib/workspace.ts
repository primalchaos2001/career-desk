import { ResumeDoc } from "@tailorats/core";
import { z } from "zod";
import { buildCorpus, type Corpus, type MatchResult, scoreMatch } from "./match/matcher";

const text = z.string().max(100_000);
const short = z.string().max(2_000);
const numeric = z
  .string()
  .refine(
    (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    "Enter a positive number or leave blank",
  );
const id = z.string().min(1).max(100);
const date = z.iso.datetime();
const ResumeFileSchema = z.object({
  name: short,
  mime: short,
  base64: z
    .string()
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid file encoding"),
});
export const MODES = ["research", "draft", "authorized"] as const;
export const TRACKS = [
  "consulting",
  "product",
  "psychology",
  "marketing",
  "finance",
  "hr",
  "operations",
  "other",
] as const;
export const STATUSES = [
  "prepared",
  "attempted",
  "blocked",
  "unknown",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type Status = (typeof STATUSES)[number];
export const ProfileSchema = z.object({
  name: short,
  email: z
    .string()
    .max(254)
    .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email"),
  phone: short,
  city: short,
  headline: short,
  summary: text,
  skills: text,
  languages: short,
  qualifications: text,
  credentials: short,
  experienceYears: numeric,
  noticeDays: numeric,
  currentLpa: numeric,
  expectedLpa: numeric,
  portfolio: short,
  resumeText: text,
  resumeDoc: ResumeDoc.optional(),
  resumeFile: ResumeFileSchema.optional(),
  /** RenderCV layout for CV PDFs (lib/cv/rendercv.ts CV_THEMES). */
  cvTheme: z.string().max(40).default("classic"),
});
const day = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "expected YYYY-MM-DD");
/**
 * Automatic morning search for a campaign (lib/schedule.ts). Runs only while
 * Career Desk is open on this PC. Job boards cost nothing; the assistant search
 * uses the user's plan allowance and is off unless they turn it on.
 */
export const ScheduleSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/),
  /** Last day (inclusive, local) the search runs; extending needs the user's OK. */
  until: day,
  useAssistant: z.boolean(),
  lastRunDay: day,
  lastResult: short,
  extensions: z.number().int().nonnegative(),
  consentAt: date,
});
export const CampaignSchema = z.object({
  id,
  name: z.string().min(1).max(150),
  track: z.enum(TRACKS),
  titles: short,
  locations: short,
  keywords: short,
  exclusions: short,
  minLpa: numeric,
  maxLpa: numeric,
  mode: z.enum(MODES),
  templateId: id,
  notes: text,
  createdAt: date,
  schedule: ScheduleSchema.optional(),
});
export const JobSchema = z.object({
  id,
  campaignId: id,
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  url: short.refine((v) => {
    try {
      canonicalUrl(v);
      return true;
    } catch {
      return false;
    }
  }, "Use a valid http or https URL"),
  location: short,
  description: text,
  salaryLpa: numeric,
  minExperience: numeric,
  requiredCredentials: short,
  requiredLanguages: short,
  /** Employer's own website, when known (used to find published recruiter emails). */
  website: short.default(""),
  notes: text,
  createdAt: date,
  verifiedAt: z.union([date, z.literal("")]),
  archived: z.boolean(),
});
export const TemplateSchema = z.object({
  id,
  name: z.string().min(1).max(150),
  kind: z.enum(["cover", "outreach"]),
  body: text,
  /** When the user wrote or confirmed this template. Starter templates have "". */
  reviewedAt: z.union([date, z.literal("")]).default(""),
  version: z.number().int().positive(),
});
export const ApplicationSchema = z.object({
  id,
  jobId: id,
  campaignId: id,
  status: z.enum(STATUSES),
  createdAt: date,
  updatedAt: date,
  followUp: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  evidence: text,
  notes: text,
  coverLetter: text,
  outreach: text,
  resume: text,
  profileSnapshot: ProfileSchema,
  templateVersion: z.number().int().positive(),
  attachmentId: id.optional(),
  /** Set only by the user in the app: allows an assistant to fill this job's application form. */
  fillApprovedAt: z.union([date, z.literal("")]).default(""),
});
const publicUrl = short.refine((v) => {
  try {
    canonicalUrl(v);
    return true;
  } catch {
    return false;
  }
}, "Add the public http(s) page where this was found");
export const ContactSchema = z.object({
  id,
  campaignId: id,
  company: z.string().min(1).max(200),
  name: short,
  role: short,
  email: z
    .string()
    .max(254)
    .refine((v) => z.email().safeParse(v).success, "Enter a valid email"),
  sourceUrl: publicUrl,
  notes: text,
  doNotContact: z.boolean(),
  createdAt: date,
});
export const OUTREACH_STATUSES = [
  "draft",
  "approved",
  /** Claimed by one sender; not yet confirmed. Never released automatically. */
  "sending",
  "sent",
  "failed",
  "unknown",
  "rejected",
] as const;
export const OutreachSchema = z.object({
  id,
  campaignId: id,
  contactId: id,
  jobId: id.optional(),
  subject: z.string().min(1).max(300),
  body: text,
  attachCv: z.boolean(),
  /** Who wrote the text: the user's template, the assistant, or the user by hand. */
  origin: z.enum(["template", "assistant", "you"]).default("template"),
  status: z.enum(OUTREACH_STATUSES),
  approvedAt: z.union([date, z.literal("")]),
  /** CV copy frozen at approval, so later profile changes can't alter what is sent. */
  attachmentId: id.optional(),
  /** Set when a sender claims the email; results must quote it. */
  claimId: z.string().max(100).default(""),
  claimedAt: z.union([date, z.literal("")]).default(""),
  claimedBy: short.default(""),
  sentAt: z.union([date, z.literal("")]),
  evidence: text,
  notes: text,
  createdAt: date,
  updatedAt: date,
});
export const SessionSchema = z.object({
  id,
  campaignId: id,
  title: z.string().min(1).max(200),
  host: z.enum(["manual", "codex", "cowork", "other"]),
  status: z.enum(["active", "completed"]),
  notes: text,
  nextAction: text,
  createdAt: date,
  updatedAt: date,
});
export const EventSchema = z.object({ id, at: date, message: short });
export const WorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  revision: z.number().int().nonnegative(),
  updatedAt: date,
  profile: ProfileSchema,
  campaigns: z.array(CampaignSchema).max(100),
  jobs: z.array(JobSchema).max(5000),
  applications: z.array(ApplicationSchema).max(5000),
  templates: z.array(TemplateSchema).max(100),
  sessions: z.array(SessionSchema).max(2000),
  events: z.array(EventSchema).max(20_000),
  attachments: z.array(ResumeFileSchema.extend({ id })).max(100).default([]),
  contacts: z.array(ContactSchema).max(5000).default([]),
  outreach: z.array(OutreachSchema).max(20_000).default([]),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Profile = Workspace["profile"];
export type Campaign = Workspace["campaigns"][number];
export type Job = Workspace["jobs"][number];
export type Application = Workspace["applications"][number];
export type Session = Workspace["sessions"][number];
export type Template = Workspace["templates"][number];
export type Contact = Workspace["contacts"][number];
export type Outreach = Workspace["outreach"][number];
export type JobInput = Omit<Job, "id" | "createdAt" | "verifiedAt" | "archived" | "website"> & {
  website?: string;
};
export const uid = () => crypto.randomUUID();
export function must<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("A required workspace record is missing. Reload your workspace.");
  return value;
}
export const now = () => new Date().toISOString();
export const tokens = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
export function canonicalUrl(value: string): string {
  const u = new URL(value.trim());
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Use an http or https job URL without credentials");
  if (/^#(?:apply|application|details)?$/i.test(u.hash)) u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|trk$|trackingId$|ref$|source$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.toString().replace(/\/$/, "");
}
export function blankWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: uid(),
    revision: 0,
    updatedAt: now(),
    profile: {
      name: "",
      email: "",
      phone: "",
      city: "",
      headline: "",
      summary: "",
      skills: "",
      languages: "",
      qualifications: "",
      credentials: "",
      experienceYears: "",
      noticeDays: "",
      currentLpa: "",
      expectedLpa: "",
      portfolio: "",
      resumeText: "",
      cvTheme: "classic",
    },
    campaigns: [],
    jobs: [],
    applications: [],
    sessions: [],
    events: [],
    attachments: [],
    contacts: [],
    outreach: [],
    templates: [
      {
        id: "cover",
        name: "Clear & personal",
        kind: "cover",
        reviewedAt: "",
        version: 1,
        body: "Dear Hiring Team,\n\nI am applying for {{role}} at {{company}}.\n\n{{summary}}\n\nMy relevant skills include {{skills}}. My qualifications: {{qualifications}}.\n\nI would welcome the opportunity to discuss my experience and learn more about the role.\n\nBest regards,\n{{name}}\n{{email}}\n{{phone}}",
      },
      {
        id: "outreach",
        name: "A short introduction",
        kind: "outreach",
        reviewedAt: "",
        version: 1,
        body: "Hello,\n\nI am interested in the {{role}} opening at {{company}}. {{headline}}\n\n{{summary}}\n\nWould you be the right person to contact about this opportunity?\n\n{{name}}\n{{email}}",
      },
    ],
  };
}
export function event(w: Workspace, message: string) {
  w.events.unshift({ id: uid(), at: now(), message });
}
export function validateWorkspace(value: unknown): Workspace {
  const w = WorkspaceSchema.parse(value);
  // Emails approved before CV copies were frozen (D-074 fix) go back for re-approval
  // instead of making the whole workspace unreadable.
  for (const o of w.outreach)
    if (
      o.status === "approved" &&
      o.attachCv &&
      !w.attachments.some((f) => f.id === o.attachmentId)
    ) {
      o.status = "draft";
      o.approvedAt = "";
      o.attachmentId = undefined;
      o.notes = [o.notes, "Approval cleared: please approve again so the CV is frozen."]
        .filter(Boolean)
        .join("\n");
    }
  for (const rows of [
    w.campaigns,
    w.jobs,
    w.applications,
    w.templates,
    w.sessions,
    w.events,
    w.attachments,
    w.contacts,
    w.outreach,
  ]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error("Duplicate record IDs in workspace");
  }
  const campaigns = new Set(w.campaigns.map((c) => c.id));
  const jobs = new Map(w.jobs.map((j) => [j.id, j]));
  const templates = new Set(w.templates.map((t) => t.id));
  if (
    !w.templates.some((t) => t.kind === "cover") ||
    !w.templates.some((t) => t.kind === "outreach")
  )
    throw new Error("Keep at least one cover-letter and one outreach template");
  for (const c of w.campaigns) {
    if (!templates.has(c.templateId)) throw new Error("Campaign template is missing");
    if (w.templates.find((t) => t.id === c.templateId)?.kind !== "cover")
      throw new Error("Campaign must use a cover-letter template");
    if (c.minLpa && c.maxLpa && Number(c.minLpa) > Number(c.maxLpa))
      throw new Error("Minimum salary exceeds maximum");
  }
  for (const j of w.jobs)
    if (!campaigns.has(j.campaignId)) throw new Error("Job campaign is missing");
  for (const s of w.sessions)
    if (!campaigns.has(s.campaignId)) throw new Error("Session campaign is missing");
  for (const a of w.applications) {
    if (["attempted", "blocked", "unknown"].includes(a.status) && !a.notes.trim())
      throw new Error("Unconfirmed attempts need a note explaining what happened");
    if (["applied", "interview", "offer", "rejected"].includes(a.status) && !a.evidence.trim())
      throw new Error("Confirmed application outcomes need a confirmation reference");
    if (a.attachmentId && !w.attachments.some((f) => f.id === a.attachmentId))
      throw new Error("Application CV attachment is missing");
    if (!jobs.has(a.jobId) || jobs.get(a.jobId)?.campaignId !== a.campaignId)
      throw new Error("Application job or campaign is missing");
  }
  for (const c of w.contacts)
    if (!campaigns.has(c.campaignId)) throw new Error("Contact campaign is missing");
  if (new Set(w.contacts.map((c) => c.email.toLowerCase())).size !== w.contacts.length)
    throw new Error("Duplicate contact emails in workspace");
  for (const o of w.outreach) {
    const contact = w.contacts.find((c) => c.id === o.contactId);
    if (!contact || contact.campaignId !== o.campaignId)
      throw new Error("Outreach contact or campaign is missing");
    if (o.jobId && !jobs.has(o.jobId)) throw new Error("Outreach job is missing");
    if (["approved", "sending", "sent", "unknown"].includes(o.status) && !o.approvedAt)
      throw new Error("Outreach must be approved before it is sent");
    if (["sending", "unknown"].includes(o.status) && (!o.claimId || !o.claimedAt))
      throw new Error("An email being sent needs its claim reference");
    if (
      ["approved", "sending"].includes(o.status) &&
      o.attachCv &&
      !w.attachments.some((f) => f.id === o.attachmentId)
    )
      throw new Error("Approved email's CV copy is missing");
    if (o.status === "sent" && (!o.evidence.trim() || !o.sentAt))
      throw new Error("Sent outreach needs a message reference");
  }
  if (new Set(w.jobs.map((j) => canonicalUrl(j.url))).size !== w.jobs.length)
    throw new Error("Duplicate job URLs in workspace");
  if (new Set(w.applications.map((a) => a.jobId)).size !== w.applications.length)
    throw new Error("Duplicate applications in workspace");
  return w;
}
export function importWorkspace(current: Workspace, incoming: unknown, replace = false): Workspace {
  const next = validateWorkspace(incoming);
  if (!replace && next.id !== current.id)
    throw new Error("This is a different workspace. Choose restore backup explicitly.");
  if (!replace && next.revision < current.revision)
    throw new Error("This export is older than your workspace. Re-export before continuing.");
  if (
    !replace &&
    next.revision === current.revision &&
    JSON.stringify(next) !== JSON.stringify(current)
  )
    throw new Error(
      "Same revision has conflicting changes. Ask the assistant to increment revision.",
    );
  return next;
}
export function addJob(w: Workspace, input: JobInput): Job {
  if (!w.campaigns.some((c) => c.id === input.campaignId))
    throw new Error("Create or select a campaign first");
  const normalized = canonicalUrl(input.url);
  if (w.jobs.some((j) => canonicalUrl(j.url) === normalized))
    throw new Error("This job is already saved, possibly in another campaign");
  const j = JobSchema.parse({
    ...input,
    url: normalized,
    id: uid(),
    createdAt: now(),
    verifiedAt: "",
    archived: false,
  });
  w.jobs.unshift(j);
  event(w, `Saved ${j.title} at ${j.company}`);
  return j;
}
/**
 * How well a job fits the candidate and campaign. Deterministic (no LLM): see
 * lib/match/matcher.ts. Pass `corpus` (other postings' text) for better
 * text-similarity weighting; `jobCorpus(w)` builds it.
 */
export function matchJob(p: Profile, c: Campaign, j: Job, corpus?: Corpus): MatchResult {
  return scoreMatch({
    cv: profileResume(p),
    candidateSkills: p.skills,
    candidateYears: p.experienceYears,
    candidateCredentials: p.credentials,
    candidateLanguages: p.languages,
    titles: c.titles,
    locations: c.locations,
    keywords: c.keywords,
    exclusions: c.exclusions,
    minLpa: c.minLpa,
    job: j,
    corpus,
  });
}
const corpora = new WeakMap<Job[], Corpus>();
/** Word statistics of the saved jobs, so rare words count above boilerplate. */
export function jobCorpus(w: Workspace): Corpus {
  let c = corpora.get(w.jobs);
  if (!c) {
    c = buildCorpus(
      w.jobs.filter((j) => !j.archived && j.description).map((j) => `${j.title}\n${j.description}`),
    );
    corpora.set(w.jobs, c);
  }
  return c;
}
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/{{\s*([\w]+)\s*}}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown template variable: ${key}`);
    return values[key] || `[Add ${key}]`;
  });
}
/**
 * Apply a profile form's edits onto the latest saved profile. Only fields the
 * user changed since opening the form are written, so changes made meanwhile
 * (another tab, an assistant, a CV import) to other fields are kept. If a field
 * the user changed was also changed elsewhere, nothing is written.
 */
export function mergeProfileEdit(latest: Profile, opened: Profile, edited: Profile): Profile {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const keys = (Object.keys(edited) as (keyof Profile)[]).filter(
    (k) => !same(edited[k], opened[k]),
  );
  const clashes = keys.filter((k) => !same(latest[k], opened[k]) && !same(latest[k], edited[k]));
  if (clashes.length)
    throw new Error(
      `Your profile changed in another tab or by your assistant while you were editing (${clashes.join(", ")}). Reload to see the latest; your changes were not saved.`,
    );
  const merged = structuredClone(latest);
  for (const k of keys) (merged as Record<string, unknown>)[k] = structuredClone(edited[k]);
  return merged;
}

export function profileResume(p: Profile): string {
  if (p.resumeText.trim()) return p.resumeText;
  return [
    p.name,
    p.headline,
    [p.email, p.phone, p.city, p.portfolio].filter(Boolean).join(" · "),
    "",
    "PROFILE",
    p.summary,
    "",
    "QUALIFICATIONS",
    p.qualifications,
    "",
    "SKILLS",
    p.skills,
    "",
    "LANGUAGES",
    p.languages,
    p.credentials ? `Credentials: ${p.credentials}` : "",
  ].join("\n");
}
export function prepareApplication(w: Workspace, jobId: string): Application {
  const previous = w.applications.find((a) => a.jobId === jobId);
  if (previous) return previous;
  const j = w.jobs.find((v) => v.id === jobId);
  if (!j) throw new Error("Job not found");
  const c = w.campaigns.find((v) => v.id === j.campaignId);
  if (!c) throw new Error("Campaign not found");
  if (c.mode === "research")
    throw new Error("This campaign is research only. Change its permissions to prepare documents.");
  if (!w.profile.name || !w.profile.email)
    throw new Error("Save your name and email in Profile first");
  const t = w.templates.find((v) => v.id === c.templateId);
  if (!t) throw new Error("Cover-letter template not found");
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(w.profile).filter(([, v]) => typeof v === "string")),
    role: j.title,
    company: j.company,
    location: j.location,
  };
  const file = w.profile.resumeFile;
  let attachmentId: string | undefined;
  if (file) {
    const existing = w.attachments.find((f) => f.base64 === file.base64 && f.name === file.name);
    attachmentId = existing?.id ?? uid();
    if (!existing) w.attachments.push({ ...file, id: attachmentId });
  }
  const a: Application = {
    id: uid(),
    jobId,
    campaignId: j.campaignId,
    status: "prepared",
    createdAt: now(),
    updatedAt: now(),
    followUp: "",
    notes: "",
    evidence: "",
    coverLetter: renderTemplate(t.body, values),
    outreach: renderTemplate(
      w.templates.find((v) => v.kind === "outreach")?.body ?? "{{name}}",
      values,
    ),
    resume: profileResume(w.profile),
    profileSnapshot: structuredClone({ ...w.profile, resumeFile: undefined }),
    templateVersion: t.version,
    attachmentId,
    fillApprovedAt: "",
  };
  w.applications.unshift(a);
  event(w, `Prepared application for ${j.company}; nothing submitted`);
  return a;
}
export function setApplicationStatus(
  w: Workspace,
  appId: string,
  status: Status,
  evidence: string,
) {
  const a = w.applications.find((v) => v.id === appId);
  if (!a) throw new Error("Application not found");
  if (["attempted", "blocked", "unknown"].includes(status) && !a.notes.trim())
    throw new Error("Add an application note explaining the unconfirmed attempt");
  if (["applied", "interview", "offer", "rejected"].includes(status) && !evidence.trim())
    throw new Error("Add a confirmation reference or note before recording this outcome");
  a.status = status;
  a.evidence = evidence;
  a.updatedAt = now();
  event(w, `Recorded ${status}: ${w.jobs.find((v) => v.id === a.jobId)?.company}`);
}
export function searchLinks(c: Campaign) {
  const query = `${tokens(c.titles).join(" OR ")} ${tokens(c.locations).join(" OR ")} jobs`;
  const sites =
    c.track === "psychology"
      ? ["yourdost.com/jobs", "amahahealth.com/careers", "naukri.com"]
      : c.track === "product"
        ? ["cutshort.io", "iimjobs.com", "wellfound.com"]
        : ["iimjobs.com", "naukri.com", "linkedin.com/jobs"];
  return sites.map((site) => ({
    label: site,
    url: `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${query}`)}`,
  }));
}
