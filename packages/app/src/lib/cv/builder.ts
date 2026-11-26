import { ResumeDoc } from "@tailorats/core";
import { resumeToText } from "../cvImport";
import { autofillProfile } from "../onboarding";
import type { Profile } from "../workspace";

/**
 * Building a CV from scratch. The person fills a form, or asks ChatGPT, Gemini
 * or Antigravity to interview them and paste back JSON in this shape. Either
 * way the result is a ResumeDoc (JSON Resume) that RenderCV turns into a PDF.
 */

const META = {
  sourceFormat: "builder" as const,
  texSourceMap: [],
  regionSignals: {
    hasPhoto: false,
    hasDateOfBirth: false,
    hasMaritalStatus: false,
    hasNationality: false,
    hasDeclarationLine: false,
    spellingVariant: "unknown" as const,
  },
};

export function emptyCv(p: Partial<Profile> = {}): ResumeDoc {
  return {
    basics: {
      name: p.name ?? "",
      label: p.headline || undefined,
      email: p.email || undefined,
      phone: p.phone || undefined,
      summary: p.summary || undefined,
      location: p.city ? { city: p.city } : undefined,
      profiles: [],
    },
    work: [],
    education: [],
    skills: [],
    projects: [],
    awards: [],
    certificates: [],
    languages: [],
    meta: META,
  };
}

/** The JSON shape assistants are asked to return (a small part of JSON Resume). */
const EXAMPLE = {
  basics: {
    name: "Full Name",
    label: "Target job title",
    email: "name@example.com",
    phone: "+91 98xxxxxxxx",
    location: { city: "City" },
    summary: "Two or three sentences, only facts the person gave.",
    profiles: [{ network: "LinkedIn", username: "their-handle" }],
  },
  work: [
    {
      name: "Employer",
      position: "Job title",
      location: "City",
      startDate: "2023-07",
      endDate: "2024-12",
      highlights: ["Started with a verb; numbers only if the person gave them"],
    },
  ],
  education: [
    {
      institution: "College",
      studyType: "BTech",
      area: "Field of study",
      startDate: "2019-08",
      endDate: "2023-05",
      score: "8.1/10 CGPA",
    },
  ],
  projects: [{ name: "Project", description: "One line", highlights: ["What they did"] }],
  skills: [{ name: "Group, e.g. Languages", keywords: ["Skill", "Skill"] }],
  certificates: [{ name: "Certificate", issuer: "Issuer", date: "2024-03" }],
  languages: [{ language: "English", fluency: "Professional" }],
};

/** Instructions to paste into ChatGPT, Gemini or Antigravity. */
export function assistantPrompt(role: string): string {
  return `Help me write my CV${role ? ` for ${role} roles` : ""}.

Ask me questions one section at a time: contact details, education, work experience and internships, projects, skills, certifications, languages. Ask follow-up questions to get concrete results (what I built, what changed, numbers I actually know).

Rules:
- Use only what I tell you. Never invent employers, dates, grades, numbers, tools or skills. If something is missing, ask me or leave it out.
- Bullet points: short, start with a verb, one idea each.
- Dates as YYYY-MM. Leave endDate out for a current role.

When I say "done", reply with only this JSON (no other text), filled with my details:

${JSON.stringify(EXAMPLE, null, 2)}`;
}

/** Parse what an assistant returned (JSON, possibly inside a code block). */
export function cvFromAssistantJson(text: string): ResumeDoc {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("No JSON found. Paste the assistant's whole reply.");
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("That isn't valid JSON. Ask the assistant to reply with only the JSON.");
  }
  const r = raw as Record<string, unknown>;
  const basics = (r.basics ?? {}) as Record<string, unknown>;
  const parsed = ResumeDoc.safeParse({
    ...r,
    basics: { profiles: [], ...basics, name: String(basics.name ?? "") },
    meta: META,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `The CV data has a problem at ${first?.path.join(".") || "the top"}: ${first?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** Store a built CV in the profile and fill the profile fields from it. */
export function applyCvToProfile(p: Profile, doc: ResumeDoc): Profile {
  const b = doc.basics;
  return autofillProfile({
    ...p,
    name: b.name || p.name,
    email: b.email || p.email,
    phone: b.phone || p.phone,
    city: b.location?.city || p.city,
    headline: b.label || p.headline,
    summary: b.summary || p.summary,
    qualifications: doc.education.length
      ? doc.education
          .map((e) => `${[e.studyType, e.area].filter(Boolean).join(" ")} — ${e.institution}`)
          .join("\n")
      : p.qualifications,
    languages: doc.languages.length ? doc.languages.map((l) => l.language).join(", ") : p.languages,
    credentials: doc.certificates.length
      ? doc.certificates.map((c) => c.name).join(", ")
      : p.credentials,
    skills: "",
    experienceYears: "",
    resumeDoc: doc,
    resumeText: resumeToText(doc),
  });
}
