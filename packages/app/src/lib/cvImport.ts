import type { ResumeDoc } from "@tailorats/core";
import { extractCandidateResume } from "./analyzeClient";
import { autofillProfile } from "./onboarding";
import { must, type Profile } from "./workspace";

/**
 * Read a CV file (PDF, .tex or text) into the profile, filling only empty
 * fields, then derive skills and years of experience from it.
 */
export async function profileFromCvFile(prev: Profile, file: File): Promise<Profile> {
  if (file.size > 5_000_000) throw new Error("CV must be 5 MB or smaller");
  if (!/\.(pdf|tex|txt)$/i.test(file.name)) throw new Error("Choose a PDF, .tex, or plain-text CV");
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(must(String(r.result).split(",")[1]));
    r.onerror = () => reject(new Error("File read failed"));
    r.readAsDataURL(file);
  });
  if (/\.txt$/i.test(file.name)) {
    const content = await file.text();
    if (content.length > 100_000)
      throw new Error("Text CV must contain fewer than 100,000 characters");
    return autofillProfile({
      ...prev,
      resumeText: content,
      resumeFile: { name: file.name, mime: file.type || "text/plain", base64 },
      resumeDoc: undefined,
    });
  } else {
    const doc = await extractCandidateResume(file);
    const fullText = resumeToText(doc);
    return autofillProfile({
      ...prev,
      name: prev.name || doc.basics.name,
      email: prev.email || doc.basics.email || "",
      phone: prev.phone || doc.basics.phone || "",
      city: prev.city || doc.basics.location?.city || "",
      headline: prev.headline || doc.basics.label || "",
      languages: prev.languages || doc.languages.map((r) => r.language).join(", "),
      summary: prev.summary || doc.basics.summary || "",
      qualifications:
        prev.qualifications ||
        doc.education
          .map((r) => `${r.studyType || ""} ${r.area || ""} — ${r.institution}`)
          .join("\n"),
      // Left blank so autofillProfile fills it from the CV's skills list and
      // every known skill named anywhere in the CV.
      skills: prev.skills,
      resumeDoc: doc,
      resumeText: fullText,
      resumeFile: { name: file.name, mime: file.type || "application/octet-stream", base64 },
    });
  }
}

/** Plain text of a CV, used for matching and the claims check. */
export function resumeToText(doc: ResumeDoc): string {
  return [
    doc.basics.name,
    doc.basics.label,
    doc.basics.summary,
    ...doc.work.flatMap((r) => [
      r.name,
      r.position,
      [r.startDate, r.endDate].filter(Boolean).join(" – "),
      r.summary,
      ...r.highlights,
    ]),
    ...doc.education.map(
      (r) =>
        `${r.studyType || ""} ${r.area || ""} — ${r.institution} ${[r.startDate, r.endDate].filter(Boolean).join(" – ")}`,
    ),
    ...doc.projects.flatMap((r) => [r.name, r.description, ...r.highlights]),
    ...doc.skills.map((r) => `${r.name}: ${r.keywords.join(", ")}`),
    ...doc.certificates.map((r) => `${r.name} · ${r.issuer || ""} · ${r.date || ""}`),
    ...doc.awards.map((r) => `${r.title} · ${r.awarder || ""} · ${r.date || ""}`),
    ...doc.languages.map((r) => `${r.language} · ${r.fluency || ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}
