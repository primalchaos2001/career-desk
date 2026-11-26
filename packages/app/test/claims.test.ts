import { describe, expect, it } from "vitest";
import { checkClaims } from "../src/lib/claims";
import { addContact, approveOutreach, draftOutreach } from "../src/lib/outreach";
import { blankWorkspace, type Profile } from "../src/lib/workspace";

const profile = (): Profile => ({
  ...blankWorkspace().profile,
  name: "Test User",
  email: "test@example.com",
  experienceYears: "1.3",
  qualifications: "M.Tech Biomedical Engineering, IIT Madras; B.Tech Biomedical Engineering",
  skills: "SystemVerilog, UVM, Python, Xcelium",
  resumeText:
    "Design & Verification Engineer at Example Silicon since July 2025. Reduced regression time by 30%.",
});
const kinds = (text: string) => checkClaims(profile(), text, { company: "Arm" }).map((w) => w.kind);

describe("claims check", () => {
  it("passes a letter that only uses profile facts", () => {
    const text =
      "As a Design & Verification Engineer at Example Silicon with an M.Tech, I build SystemVerilog/UVM testbenches in Xcelium and cut regression time by 30%. I'd like to join Arm.";
    expect(checkClaims(profile(), text, { company: "Arm" })).toEqual([]);
  });

  it("flags leftover placeholders", () => {
    expect(kinds("Hello [Add headline] and {{summary}}")).toEqual(["placeholder", "placeholder"]);
  });

  it("flags experience beyond the profile but not a degree length", () => {
    expect(kinds("I have 2+ years of experience in verification.")).toEqual(["experience"]);
    expect(kinds("I bring two years of industry experience.")).toEqual(["experience"]);
    expect(kinds("I have 1 year of hands-on experience.")).toEqual([]);
    expect(kinds("I completed a 4 years degree programme.")).toEqual([]);
  });

  it("flags degrees and subjects the profile doesn't have", () => {
    expect(kinds("I hold a B.E. in Electronics.")).toEqual(["degree", "degree"]);
    expect(kinds("My M.Tech in Biomedical Engineering")).toEqual([]);
  });

  it("flags named tools, employers and figures missing from the profile", () => {
    expect(kinds("I used VCS and Verdi daily.")).toEqual(["skill", "skill"]);
    expect(kinds("I previously worked at Qualcomm India.")).toEqual(["employer"]);
    expect(kinds("I improved coverage by 45% across 10,000 tests.")).toEqual(["figure", "figure"]);
  });

  it("ignores the target company itself", () => {
    expect(kinds("I would enjoy a role at Arm.")).toEqual([]);
  });
});

describe("approvals and placeholders", () => {
  it("won't approve an email that still has template placeholders", () => {
    const w = blankWorkspace();
    for (const t of w.templates) t.reviewedAt = new Date().toISOString();
    w.profile = profile();
    w.campaigns.push({
      id: "c",
      name: "VLSI",
      track: "other",
      titles: "",
      locations: "",
      keywords: "",
      exclusions: "",
      minLpa: "",
      maxLpa: "",
      mode: "draft",
      templateId: "cover",
      notes: "",
      createdAt: new Date().toISOString(),
    });
    const c = addContact(w, {
      campaignId: "c",
      company: "Arm",
      email: "hr@example.com",
      sourceUrl: "https://example.com/careers",
    });
    // Profile has no headline/summary, so the default template leaves placeholders.
    const o = draftOutreach(w, c.id, { attachCv: false });
    expect(o.body).toContain("[Add headline]");
    expect(() => approveOutreach(w, o.id, { reviewed: true })).toThrow(/placeholders/);
    o.body = "Hello, I build UVM testbenches at Example Silicon.";
    expect(() => approveOutreach(w, o.id, { reviewed: true })).not.toThrow();
  });
});
