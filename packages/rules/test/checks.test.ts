import { describe, expect, it } from "vitest";
import { checks } from "../src/checks/index.js";
import { makeDoc } from "./helpers.js";

describe("generic check: skills-keywords-missing", () => {
  const checkFn = checks["skills-keywords-missing"];
  if (!checkFn) throw new Error("skills-keywords-missing not registered");

  it("triggers when keywords list is empty", () => {
    const doc = makeDoc({ skills: [{ name: "Languages", keywords: [] }] });
    const res = checkFn(doc, { anyOf: ["Python", "SQL"], match: "substring" });
    expect(res.triggered).toBe(true);
  });

  it("does not trigger on case-insensitive substring match", () => {
    const doc = makeDoc({ skills: [{ name: "Languages", keywords: ["postgresql", "python"] }] });
    const res = checkFn(doc, { anyOf: ["SQL", "Java"], match: "substring" });
    expect(res.triggered).toBe(false); // postgresql contains sql
  });

  it("exact match triggers when keyword is substring but not exact", () => {
    const doc = makeDoc({ skills: [{ name: "Languages", keywords: ["postgresql"] }] });
    const res = checkFn(doc, { anyOf: ["sql"], match: "exact" });
    expect(res.triggered).toBe(true); // postgresql is not exactly sql
  });

  it("exact match does not trigger on exact match (case-insensitive)", () => {
    const doc = makeDoc({ skills: [{ name: "Languages", keywords: ["Sql"] }] });
    const res = checkFn(doc, { anyOf: ["sql"], match: "exact" });
    expect(res.triggered).toBe(false);
  });
});

describe("generic check: certifications-missing", () => {
  const checkFn = checks["certifications-missing"];
  if (!checkFn) throw new Error("certifications-missing not registered");

  it("triggers when both certificates and skill keywords are missing", () => {
    const doc = makeDoc({ skills: [{ name: "Finance", keywords: ["excel"] }], certificates: [] });
    const res = checkFn(doc, { orSkillKeywords: ["cfa", "cfi"] });
    expect(res.triggered).toBe(true);
  });

  it("does not trigger when certificates is populated", () => {
    const doc = makeDoc({ skills: [] });
    doc.certificates = [{ name: "CFA Level I", issuer: "CFA", date: "2024" }];
    const res = checkFn(doc, { orSkillKeywords: ["cfa"] });
    expect(res.triggered).toBe(false);
  });

  it("does not trigger when matching skill keyword is present (case-insensitive substring)", () => {
    const doc = makeDoc({
      skills: [{ name: "Skills", keywords: ["CFA Level 1 Candidate"] }],
      certificates: [],
    });
    const res = checkFn(doc, { orSkillKeywords: ["cfa"] });
    expect(res.triggered).toBe(false);
  });
});

describe("check: work-missing", () => {
  const checkFn = checks["work-missing"];
  if (!checkFn) throw new Error("work-missing not registered");

  it("triggers when work experience is empty", () => {
    const doc = makeDoc({ work: [] });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(true);
  });

  it("does not trigger when work experience is present", () => {
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Intern", startDate: "2024", highlights: [] }],
    });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(false);
  });
});

describe("check: leadership-missing", () => {
  const checkFn = checks["leadership-missing"];
  if (!checkFn) throw new Error("leadership-missing not registered");

  it("triggers when both awards and leadership roles are missing", () => {
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Software Developer", highlights: [] }],
      awards: [],
      projects: [{ name: "P1", roles: ["Contributor"] }],
    });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(true);
  });

  it("does not trigger when awards are present", () => {
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Developer", highlights: [] }],
      awards: [{ title: "Best Project Award", date: "2024" }],
    });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(false);
  });

  it("does not trigger when a leadership role is found in work position", () => {
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Lead Engineer", highlights: [] }],
      awards: [],
    });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(false);
  });

  it("does not trigger when a leadership role is found in project roles", () => {
    const doc = makeDoc({
      work: [{ name: "Acme", position: "Engineer", highlights: [] }],
      projects: [{ name: "P1", roles: ["Project Manager"] }],
      awards: [],
    });
    const res = checkFn(doc, {});
    expect(res.triggered).toBe(false);
  });
});
