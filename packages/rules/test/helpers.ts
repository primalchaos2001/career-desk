import { ResumeDoc } from "@tailorats/core";

/**
 * Build a valid ResumeDoc from a sparse override object. The base is a
 * deliberately "clean" resume that should trigger no rules; positive fixtures
 * mutate exactly one aspect.
 */
// biome-ignore lint/suspicious/noExplicitAny: test-only deep-partial input
export function makeDoc(overrides: Record<string, any> = {}): ResumeDoc {
  return ResumeDoc.parse({
    basics: {
      name: "Test Student",
      email: "test@example.edu",
      profiles: [{ network: "GitHub", url: "https://github.com/test" }],
      ...overrides.basics,
    },
    education: overrides.education ?? [
      {
        institution: "Test University",
        area: "CS",
        gpa: { value: 3.6, scale: 4.0 },
        coursework: ["Algorithms"],
      },
    ],
    work: overrides.work ?? [],
    skills: overrides.skills ?? [],
    projects: overrides.projects ?? [
      {
        name: "proj",
        githubUrl: "https://github.com/test/proj",
        highlights: ["Cut build time 30% by caching artifacts"],
      },
    ],
    awards: overrides.awards ?? [],
    certificates: overrides.certificates ?? [],
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
