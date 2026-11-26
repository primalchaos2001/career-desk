import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResumeDoc } from "@tailorats/core";
import { describe, expect, it } from "vitest";
import { runPythonTool } from "../server/discovery/python";
import { profileToResume, resumeToRenderCv } from "../src/lib/cv/rendercv";
import { scoreMatch } from "../src/lib/match/matcher";
import { blankWorkspace } from "../src/lib/workspace";

const doc: ResumeDoc = {
  basics: {
    name: "Asha Rao",
    label: "Design Verification Engineer",
    email: "asha@example.com",
    phone: "98450 00000",
    location: { city: "Bengaluru", countryCode: "IN" },
    profiles: [
      { network: "LinkedIn", username: "asha-rao" },
      { network: "Twitter", username: "x" },
    ],
  },
  work: [
    {
      name: "Chipco",
      position: "DV Engineer",
      startDate: "2024-07",
      highlights: ["Wrote Python regression scripts", "Built a UVM testbench with SVA checks"],
    },
  ],
  education: [
    {
      institution: "NIT",
      area: "Electronics",
      studyType: "BTech",
      endDate: "2024",
      courses: [],
      coursework: [],
    },
  ],
  skills: [{ name: "Verification", keywords: ["Python", "UVM", "SystemVerilog"] }],
  projects: [],
  awards: [],
  certificates: [],
  languages: [{ language: "English" }],
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

const uvmJob = scoreMatch({
  cv: "UVM SystemVerilog",
  candidateSkills: "",
  candidateYears: "",
  candidateCredentials: "",
  candidateLanguages: "",
  titles: "",
  locations: "",
  keywords: "",
  exclusions: "",
  minLpa: "",
  job: {
    company: "X",
    title: "Verification Engineer",
    location: "",
    description: "Requirements: UVM, SystemVerilog",
    salaryLpa: "",
    minExperience: "",
    requiredCredentials: "",
    requiredLanguages: "",
  },
});

describe("RenderCV mapping", () => {
  it("maps JSON Resume fields and drops what RenderCV would reject", () => {
    const r = resumeToRenderCv(doc);
    expect(r.cv.name).toBe("Asha Rao");
    expect(r.cv.location).toBe("Bengaluru, IN");
    expect(r.cv.phone).toBeUndefined(); // not in +country format
    expect(r.cv.social_networks).toEqual([{ network: "LinkedIn", username: "asha-rao" }]);
    expect(r.cv.sections.experience?.[0]).toMatchObject({
      company: "Chipco",
      start_date: "2024-07",
      end_date: "present",
    });
    expect(r.cv.sections.education?.[0]).toMatchObject({ area: "Electronics", degree: "BTech" });
  });

  it("tailors by reordering only", () => {
    const r = resumeToRenderCv(doc, { match: uvmJob });
    const exp = r.cv.sections.experience?.[0] as { highlights: string[] };
    expect(exp.highlights[0]).toMatch(/UVM/);
    expect(exp.highlights).toHaveLength(2);
    const skills = r.cv.sections.skills?.[0] as { details: string };
    expect(skills.details).toBe("UVM, SystemVerilog, Python");
  });

  it("builds a starter CV from the profile form when no CV was read", () => {
    const p = blankWorkspace().profile;
    p.name = "Ravi";
    p.skills = "Excel, SQL";
    p.qualifications = "MBA, IIM Indore\nBCom, Delhi University";
    const r = resumeToRenderCv(profileToResume(p));
    expect(r.cv.sections.skills).toEqual([{ label: "Skills", details: "Excel, SQL" }]);
    expect(r.cv.sections.education).toHaveLength(2);
  });

  const venv = join(__dirname, "..", "..", "..", ".venv");
  it.skipIf(!existsSync(venv))(
    "renders a real PDF with RenderCV",
    async () => {
      const out = await runPythonTool<{ pdfBase64: string; markdown: string }>("render_cv.py", {
        doc: resumeToRenderCv(doc),
      });
      expect(Buffer.from(out.pdfBase64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      expect(out.markdown).toMatch(/Chipco/);
    },
    200_000,
  );
});

describe("CV builder", () => {
  it("parses an assistant's reply, even inside a code block, and fills the profile", async () => {
    const { applyCvToProfile, assistantPrompt, cvFromAssistantJson } = await import(
      "../src/lib/cv/builder"
    );
    expect(assistantPrompt("Data Analyst")).toMatch(/Never invent/);
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
      basics: { name: "Ravi Kumar", label: "Data Analyst", email: "ravi@example.com" },
      work: [
        {
          name: "Shop",
          position: "Analyst",
          startDate: "2023-01",
          highlights: ["Built SQL reports"],
        },
      ],
      skills: [{ name: "Tools", keywords: ["SQL", "Excel"] }],
    })}\n\`\`\``;
    const doc = cvFromAssistantJson(reply);
    expect(doc.basics.name).toBe("Ravi Kumar");
    const p = applyCvToProfile(blankWorkspace().profile, doc);
    expect(p.headline).toBe("Data Analyst");
    expect(p.skills).toMatch(/SQL/);
    expect(p.experienceYears).not.toBe("");
    expect(p.resumeText).toMatch(/Built SQL reports/);
    expect(() => cvFromAssistantJson("no json here")).toThrow(/No JSON/);
    expect(() => cvFromAssistantJson('{"work": [{"startDate": "last year"}]}')).toThrow(/problem/);
  });
});
