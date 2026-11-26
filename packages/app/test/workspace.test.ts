import { describe, expect, it } from "vitest";
import {
  addJob,
  blankWorkspace,
  canonicalUrl,
  importWorkspace,
  matchJob,
  prepareApplication,
  renderTemplate,
  setApplicationStatus,
  validateWorkspace,
} from "../src/lib/workspace";

describe("career workspace invariants", () => {
  it("deduplicates employer jobs across campaigns without removing meaningful query IDs", () => {
    const w = blankWorkspace();
    const c = {
      id: "c",
      name: "Consulting",
      track: "consulting",
      titles: "Consultant",
      locations: "Mumbai",
      keywords: "strategy",
      exclusions: "",
      minLpa: "",
      maxLpa: "",
      mode: "draft",
      templateId: "cover",
      notes: "",
      createdAt: new Date().toISOString(),
    } as const;
    w.campaigns.push(c, { ...c, id: "d" });
    const input = {
      campaignId: "c",
      company: "Firm",
      title: "Consultant",
      url: "https://example.com/job?id=1&utm_source=mail",
      location: "Mumbai",
      description: "strategy",
      salaryLpa: "",
      minExperience: "",
      requiredCredentials: "",
      requiredLanguages: "",
      notes: "",
    };
    addJob(w, input);
    expect(() =>
      addJob(w, { ...input, campaignId: "d", url: "https://example.com/job?id=1" }),
    ).toThrow(/already/);
    expect(canonicalUrl("https://example.com/job?id=2")).not.toBe(canonicalUrl(input.url));
    expect(() => canonicalUrl("javascript:alert(1)")).toThrow();
  });
  it("reports unknown credentials and experience, instead of assuming eligibility", () => {
    const w = blankWorkspace();
    w.campaigns.push({
      id: "c",
      name: "Psychology",
      track: "psychology",
      titles: "Psychologist",
      locations: "Chennai",
      keywords: "",
      exclusions: "",
      minLpa: "",
      maxLpa: "",
      mode: "draft",
      templateId: "cover",
      notes: "",
      createdAt: new Date().toISOString(),
    });
    const j = addJob(w, {
      campaignId: "c",
      company: "Clinic",
      title: "Psychologist",
      url: "https://example.com/job",
      location: "Chennai",
      description: "Care",
      salaryLpa: "",
      minExperience: "2",
      requiredCredentials: "RCI",
      requiredLanguages: "Tamil",
      notes: "",
    });
    const c = w.campaigns[0];
    if (!c) throw new Error("Test campaign missing");
    const match = matchJob(w.profile, c, j);
    expect(match.warnings.join(" ")).toMatch(/RCI/);
    expect(match.warnings.join(" ")).toMatch(/experience/i);
    expect(match.warnings.join(" ")).toMatch(/Tamil/);
    expect(match.eligible).toBe(false);
  });
  it("snapshots documents and requires evidence for confirmed external actions", () => {
    const w = blankWorkspace();
    w.profile.name = "Asha";
    w.profile.email = "asha@example.com";
    w.profile.summary = "Led customer research.";
    w.profile.resumeFile = { name: "CV.txt", mime: "text/plain", base64: btoa("Original CV") };
    w.campaigns.push({
      id: "c",
      name: "PM",
      track: "product",
      titles: "Product Manager",
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
    const j = addJob(w, {
      campaignId: "c",
      company: "Firm",
      title: "Product Manager",
      url: "https://example.com/pm",
      location: "Remote",
      description: "",
      salaryLpa: "",
      minExperience: "",
      requiredCredentials: "",
      requiredLanguages: "",
      notes: "",
    });
    const a = prepareApplication(w, j.id);
    w.profile.summary = "Changed later";
    expect(a.coverLetter).toContain("Led customer research.");
    expect(a.profileSnapshot.resumeFile).toBeUndefined();
    expect(w.attachments.find((f) => f.id === a.attachmentId)?.base64).toBe(btoa("Original CV"));
    w.profile.resumeFile = undefined;
    expect(w.attachments).toHaveLength(1);
    expect(prepareApplication(w, j.id).id).toBe(a.id);
    expect(() => setApplicationStatus(w, a.id, "applied", "")).toThrow(/confirmation/i);
    expect(() => setApplicationStatus(w, a.id, "unknown", "")).toThrow(/note/i);
    a.notes = "The employer page timed out before confirmation";
    setApplicationStatus(w, a.id, "unknown", "");
    expect(a.status).toBe("unknown");
    setApplicationStatus(w, a.id, "applied", "Employer email reference 123");
    expect(a.status).toBe("applied");
    const invalid = structuredClone(w);
    invalid.applications[0] = { ...a, evidence: "" };
    expect(() => validateWorkspace(invalid)).toThrow(/confirmation/i);
  });
  it("rejects stale, foreign, corrupt, and ambiguous imports", () => {
    const w = blankWorkspace();
    const updated = structuredClone(w);
    updated.revision = 2;
    expect(() => importWorkspace(updated, w)).toThrow(/older/i);
    expect(() => importWorkspace(w, blankWorkspace())).toThrow(/different/i);
    expect(() => validateWorkspace({ ...w, jobs: [{ url: "javascript:alert(1)" }] })).toThrow();
    expect(() => validateWorkspace({ ...w, campaigns: [{ id: "x" }, { id: "x" }] })).toThrow();
  });
  it("treats template text as data and rejects unknown variables", () => {
    expect(renderTemplate("Dear {{company}}", { company: "Firm" })).toBe("Dear Firm");
    expect(() => renderTemplate("{{invented_experience}}", {})).toThrow(/Unknown/);
    expect(() => renderTemplate("{{constructor}}", {})).toThrow(/Unknown/);
    expect(() => renderTemplate("{{__proto__}}", {})).toThrow(/Unknown/);
  });
});
