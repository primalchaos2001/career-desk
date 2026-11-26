import type { ResumeDoc } from "@tailorats/core";
import { extractSkills } from "./match/vocab";
import {
  type Campaign,
  CampaignSchema,
  event,
  now,
  type Profile,
  uid,
  type Workspace,
} from "./workspace";

/**
 * First-run helpers: fill the profile from the CV so nobody types their skills
 * or years twice, and create the first campaign from three answers.
 */

/** Skills named anywhere in the CV, plus the CV's own skills list, de-duplicated. */
export function skillsFromCv(text: string, doc?: ResumeDoc): string[] {
  const out = new Map<string, string>();
  for (const s of doc?.skills ?? [])
    for (const k of s.keywords.length ? s.keywords : [s.name]) {
      const v = k.trim();
      if (v) out.set(v.toLowerCase(), v);
    }
  for (const [k, v] of extractSkills(text)) if (!out.has(k)) out.set(k, v);
  return [...out.values()];
}

const monthIndex = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return (y ?? 0) * 12 + ((m ?? 1) - 1);
};

/**
 * Years of work experience from dated roles, counting overlapping roles once.
 * Internships and trainee roles are left out. A CV with education or projects
 * but no dated job counts as 0; with nothing at all, "" (unknown).
 */
export function yearsFromWork(doc: ResumeDoc | undefined, at = new Date()): string {
  const current = at.getFullYear() * 12 + at.getMonth();
  const spans = (doc?.work ?? [])
    .filter((w) => w.startDate && !/\b(intern|internship|trainee)\b/i.test(w.position ?? ""))
    .map((w) => {
      const start = monthIndex(w.startDate as string);
      const end = w.endDate ? monthIndex(w.endDate) : current;
      return [start, Math.max(start, end)] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  // A CV with no dated roles: a fresher (0) if it has any content, else unknown.
  if (!spans.length) return doc && (doc.education.length || doc.projects.length) ? "0" : "";
  let months = 0;
  let [s, e] = spans[0] as readonly [number, number];
  for (const [a, b] of spans.slice(1)) {
    if (a <= e) e = Math.max(e, b);
    else {
      months += e - s + 1;
      [s, e] = [a, b];
    }
  }
  months += e - s + 1;
  return String(Math.round((months / 12) * 2) / 2);
}

/** Fill empty profile fields from the CV. Never overwrites what the user typed. */
export function autofillProfile(p: Profile, at = new Date()): Profile {
  const skills = p.skills.trim() ? p.skills : skillsFromCv(p.resumeText, p.resumeDoc).join(", ");
  const years = p.experienceYears.trim() ? p.experienceYears : yearsFromWork(p.resumeDoc, at);
  return { ...p, skills, experienceYears: years };
}

export interface QuickStart {
  role: string;
  city: string;
  expectedLpa: string;
  remote?: boolean;
}

const TRACK_HINTS: [RegExp, Campaign["track"]][] = [
  [/consult|strategy/i, "consulting"],
  [/product|program manager/i, "product"],
  [/psycholog|counsel|therap/i, "psychology"],
  [/market|brand|growth|seo|content/i, "marketing"],
  [/financ|analyst.*(invest|equity)|account|bank|audit/i, "finance"],
  [/\bhr\b|human resource|recruit|talent/i, "hr"],
  [/operation|supply|logistic/i, "operations"],
];

/**
 * The first campaign from three answers. Draft mode, so applications and
 * email drafts can be prepared; nothing is ever sent without the user.
 */
export function quickStartCampaign(w: Workspace, q: QuickStart): Campaign {
  const role = q.role.trim();
  const city = q.city.trim();
  if (!role) throw new Error("Tell us the role you want");
  const titles = [role];
  const headline = w.profile.headline.trim();
  if (headline && headline.length < 80 && headline.toLowerCase() !== role.toLowerCase())
    titles.push(headline);
  const c = CampaignSchema.parse({
    id: uid(),
    name: city ? `${role} · ${city}` : role,
    track: TRACK_HINTS.find(([re]) => re.test(role))?.[1] ?? "other",
    titles: titles.join(", "),
    locations: [city, q.remote ? "Remote" : ""].filter(Boolean).join(", "),
    keywords: "",
    exclusions: "",
    minLpa: q.expectedLpa.trim(),
    maxLpa: "",
    mode: "draft",
    templateId: w.templates.find((t) => t.kind === "cover")?.id ?? "cover",
    notes: "",
    createdAt: now(),
  });
  w.campaigns.push(c);
  if (q.expectedLpa.trim()) w.profile.expectedLpa = q.expectedLpa.trim();
  if (city && !w.profile.city) w.profile.city = city;
  event(w, `Created campaign ${c.name}`);
  return c;
}
