import type { ResumeDoc } from "@tailorats/core";
import type { MatchResult } from "../match/matcher";
import { extractSkills } from "../match/vocab";
import type { Profile } from "../workspace";

/**
 * Builds a RenderCV input document (https://github.com/rendercv/rendercv, MIT)
 * from the candidate's CV. Career Desk stores CVs as JSON Resume (ResumeDoc),
 * so this is a field-for-field mapping; the local server runs RenderCV to make
 * a text-based PDF that applicant tracking systems can read.
 *
 * Tailoring for a job only REORDERS true content: skills and bullets that the
 * posting asks for move up. It never adds a skill or rewrites a bullet.
 */

export const CV_THEMES = ["classic", "sb2nov", "engineeringresumes", "moderncv"] as const;
export type CvTheme = (typeof CV_THEMES)[number];

type Entry = Record<string, unknown>;
export interface RenderCvDoc {
  cv: {
    name: string;
    headline?: string;
    location?: string;
    email?: string;
    phone?: string;
    website?: string;
    social_networks?: { network: string; username: string }[];
    sections: Record<string, Entry[] | string[]>;
  };
  design: { theme: CvTheme };
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const has = (s: string | undefined) => clean(s).length > 0;
const NETWORKS: Record<string, string> = { linkedin: "LinkedIn", github: "GitHub" };

/** Job skills a text mentions; used to move relevant bullets up. */
function relevance(text: string, wanted: Set<string>): number {
  let n = 0;
  for (const k of extractSkills(text).keys()) if (wanted.has(k)) n++;
  return n;
}

function byRelevance<T>(items: T[], text: (t: T) => string, wanted: Set<string>): T[] {
  if (!wanted.size) return items;
  return items
    .map((item, i) => ({ item, i, r: relevance(text(item), wanted) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.item);
}

function dates(start?: string, end?: string): Entry {
  if (!start) return end ? { date: end } : {};
  return { start_date: start, end_date: end || "present" };
}

/** The job's asked-for skills, as lower-case keys, for tailoring. */
export function tailoringKeys(match?: MatchResult): Set<string> {
  if (!match) return new Set();
  return new Set(
    [...match.skills.matched, ...match.skills.related].map((s) => s.toLowerCase().trim()),
  );
}

export function resumeToRenderCv(
  doc: ResumeDoc,
  opts: { theme?: CvTheme; match?: MatchResult } = {},
): RenderCvDoc {
  const wanted = tailoringKeys(opts.match);
  const b = doc.basics;
  const sections: RenderCvDoc["cv"]["sections"] = {};
  if (has(b.summary)) sections.summary = [clean(b.summary)];

  const work = doc.work.filter((w) => has(w.name));
  if (work.length)
    sections.experience = work.map((w) => ({
      company: clean(w.name),
      position: clean(w.position) || " ",
      ...(has(w.location) ? { location: clean(w.location) } : {}),
      ...dates(w.startDate, w.endDate),
      ...(has(w.summary) ? { summary: clean(w.summary) } : {}),
      highlights: byRelevance(w.highlights.filter(has).map(clean), (h) => h, wanted),
    }));

  const projects = doc.projects.filter((p) => has(p.name));
  if (projects.length)
    sections.projects = byRelevance(
      projects,
      (p) => [p.name, p.description, ...p.highlights, ...p.keywords].join(" "),
      wanted,
    ).map((p) => ({
      name: clean(p.name),
      ...dates(p.startDate, p.endDate),
      ...(has(p.description) ? { summary: clean(p.description) } : {}),
      highlights: byRelevance(p.highlights.filter(has).map(clean), (h) => h, wanted),
    }));

  const education = doc.education.filter((e) => has(e.institution));
  if (education.length)
    sections.education = education.map((e) => ({
      institution: clean(e.institution),
      area: clean(e.area) || clean(e.studyType) || " ",
      ...(has(e.studyType) && has(e.area) ? { degree: clean(e.studyType) } : {}),
      ...dates(e.startDate, e.endDate),
      highlights: [
        ...(e.gpa ? [`GPA: ${e.gpa.value}/${e.gpa.scale}`] : has(e.score) ? [clean(e.score)] : []),
        ...(e.coursework.length ? [`Coursework: ${e.coursework.join(", ")}`] : []),
      ],
    }));

  const skills = doc.skills.filter((s) => has(s.name) || s.keywords.length);
  if (skills.length)
    sections.skills = skills.map((s) => {
      const keywords = s.keywords.filter(has).map(clean);
      const ordered = wanted.size
        ? [
            ...keywords.filter((k) => wanted.has(k.toLowerCase())),
            ...keywords.filter((k) => !wanted.has(k.toLowerCase())),
          ]
        : keywords;
      return {
        label: clean(s.name) || "Skills",
        details: ordered.join(", ") || clean(s.level) || " ",
      };
    });

  const extras: Entry[] = [
    ...doc.certificates
      .filter((c) => has(c.name))
      .map((c) => ({ bullet: [c.name, c.issuer, c.date].filter(has).map(clean).join(", ") })),
    ...doc.awards
      .filter((a) => has(a.title))
      .map((a) => ({ bullet: [a.title, a.awarder, a.date].filter(has).map(clean).join(", ") })),
  ];
  if (extras.length) sections.certifications_and_awards = extras;
  if (doc.languages.length)
    sections.languages = [
      {
        label: "Languages",
        details: doc.languages
          .map((l) => (l.fluency ? `${l.language} (${l.fluency})` : l.language))
          .join(", "),
      },
    ];

  const location = [b.location?.city, b.location?.region, b.location?.countryCode]
    .filter(has)
    .join(", ");
  const social = b.profiles
    .map((p) => ({ network: NETWORKS[p.network.toLowerCase()], username: clean(p.username) }))
    .filter((p): p is { network: string; username: string } => !!p.network && !!p.username);
  return {
    cv: {
      name: clean(b.name) || "Your Name",
      ...(has(b.label) ? { headline: clean(b.label) } : {}),
      ...(location ? { location } : {}),
      ...(has(b.email) ? { email: clean(b.email) } : {}),
      // RenderCV only accepts international numbers (+91...); others are left out.
      ...(b.phone && /^\+\d[\d\s-]{6,}$/.test(b.phone.trim())
        ? { phone: b.phone.replace(/[\s-]/g, "") }
        : {}),
      ...(b.url && /^https?:\/\//.test(b.url) ? { website: b.url } : {}),
      ...(social.length ? { social_networks: social } : {}),
      sections,
    },
    design: { theme: opts.theme ?? "classic" },
  };
}

/**
 * A ResumeDoc from the Profile form, for people who have no CV file yet. Uses
 * only what they typed: summary, qualifications, skills and languages.
 */
export function profileToResume(p: Profile): ResumeDoc {
  if (p.resumeDoc) return p.resumeDoc;
  const lines = (s: string) =>
    s
      .split(/\n+/)
      .map((v) => v.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
  const list = (s: string) =>
    s
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  return {
    basics: {
      name: p.name,
      label: p.headline || undefined,
      email: p.email || undefined,
      phone: p.phone || undefined,
      url: p.portfolio || undefined,
      summary: p.summary || undefined,
      location: p.city ? { city: p.city } : undefined,
      profiles: [],
    },
    work: [],
    education: lines(p.qualifications).map((q) => ({
      institution: q,
      courses: [],
      coursework: [],
    })),
    skills: list(p.skills).length ? [{ name: "Skills", keywords: list(p.skills) }] : [],
    projects: [],
    awards: [],
    certificates: list(p.credentials).map((name) => ({ name })),
    languages: list(p.languages).map((language) => ({ language })),
    meta: {
      sourceFormat: "builder",
      texSourceMap: [],
      regionSignals: {
        hasPhoto: false,
        hasDateOfBirth: false,
        hasMaritalStatus: false,
        hasNationality: false,
        hasDeclarationLine: false,
        spellingVariant: "unknown",
      },
    },
  };
}
