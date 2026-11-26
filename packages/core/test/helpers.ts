import { type ResumeDoc, ResumeDoc as ResumeDocSchema } from "../src/resume.js";

/**
 * Build a valid ResumeDoc from a sparse override. Base is a clean single-page
 * résumé; tests mutate exactly the aspect under test. (Core-local twin of the
 * rules-package helper — core cannot import from the rules test tree.)
 */
// biome-ignore lint/suspicious/noExplicitAny: test-only deep-partial input
export function makeDoc(overrides: Record<string, any> = {}): ResumeDoc {
  return ResumeDocSchema.parse({
    basics: {
      name: "Test Student",
      email: "test@example.edu",
      profiles: [{ network: "GitHub", url: "https://github.com/test" }],
      ...overrides.basics,
    },
    education: overrides.education ?? [
      { institution: "Test University", area: "CS", gpa: { value: 3.6, scale: 4.0 } },
    ],
    work: overrides.work ?? [],
    skills: overrides.skills ?? [],
    projects: overrides.projects ?? [],
    awards: overrides.awards ?? [],
    certificates: [],
    languages: [],
    meta: {
      sourceFormat: "builder",
      regionSignals: {
        hasPhoto: false,
        hasDateOfBirth: false,
        hasMaritalStatus: false,
        hasNationality: false,
        hasDeclarationLine: false,
        spellingVariant: "en-US",
        pageCount: 1,
        ...overrides.regionSignals,
      },
    },
  });
}
