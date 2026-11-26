import { describe, expect, it } from "vitest";
import {
  buildCorpus,
  type MatchInput,
  postingSkills,
  scoreMatch,
  similarity,
  yearsRequired,
} from "../src/lib/match/matcher";
import { extractSkills } from "../src/lib/match/vocab";

const DV_CV = `Design verification engineer. SystemVerilog and UVM testbenches for an audio
accelerator ASIC; SVA assertions; Xcelium and SimVision; AXI and APB; Python and Perl scripts.`;

const DV_JD = `Senior Design Verification Engineer
Requirements:
- 3+ years of experience in ASIC verification
- SystemVerilog, UVM, SVA
- Experience with Questa or VCS
- AMBA protocols (AXI, AHB)
Nice to have:
- Formal verification with JasperGold
- PCIe`;

function input(over: Partial<MatchInput> = {}, job: Partial<MatchInput["job"]> = {}): MatchInput {
  return {
    cv: DV_CV,
    candidateSkills: "",
    candidateYears: "2",
    candidateCredentials: "",
    candidateLanguages: "",
    titles: "Design Verification Engineer",
    locations: "Bengaluru",
    keywords: "",
    exclusions: "",
    minLpa: "",
    ...over,
    job: {
      company: "Chipco",
      title: "Senior Design Verification Engineer",
      location: "Bengaluru, India",
      description: DV_JD,
      salaryLpa: "",
      minExperience: "",
      requiredCredentials: "",
      requiredLanguages: "",
      ...job,
    },
  };
}

describe("skill vocabulary", () => {
  it("recognises software skills from career-ops and hardware skills from rule packs", () => {
    const s = extractSkills("Python, k8s, SystemVerilog, UVM, Xcelium, AXI and JasperGold");
    expect([...s.values()]).toEqual(
      expect.arrayContaining([
        "Python",
        "Kubernetes",
        "SystemVerilog",
        "UVM",
        "Xcelium",
        "AXI",
        "JasperGold",
      ]),
    );
  });
  it("does not read short acronyms out of ordinary words", () => {
    const s = extractSkills("We stay in the spirit of status reports and apical design.");
    expect(s.has("sta")).toBe(false);
    expect(s.has("spi")).toBe(false);
    expect(s.has("apb")).toBe(false);
  });
});

describe("posting structure", () => {
  it("separates required from nice-to-have skills", () => {
    const skills = postingSkills("DV Engineer", DV_JD);
    expect(skills.get("systemverilog")?.weight).toBe(1);
    expect(skills.get("jaspergold")?.weight).toBe(0.5);
    expect(skills.get("pcie")?.weight).toBe(0.5);
  });
  it("reads the minimum years asked for", () => {
    expect(yearsRequired("3+ years of experience in ASIC verification")).toBe(3);
    expect(yearsRequired("2-4 yrs experience")).toBe(2);
    expect(yearsRequired("Minimum 5 years in sales")).toBe(5);
    expect(yearsRequired("Founded 20 years ago")).toBeNull();
    expect(yearsRequired("ASIC Engineer - Design Verification, 7-12 Yrs, Bangalore")).toBe(7);
    expect(yearsRequired("**Location:** Bengaluru **Experience:** 4 to 10 Years **Job")).toBe(4);
  });
});

describe("scoreMatch", () => {
  it("explains matched, related and missing skills", () => {
    const r = scoreMatch(input());
    expect(r.skills.matched).toEqual(
      expect.arrayContaining(["SystemVerilog", "UVM", "SVA", "AXI"]),
    );
    // Questa/VCS and AHB are related to Xcelium and AXI (same rule-pack group).
    expect(r.skills.related).toEqual(expect.arrayContaining(["Questa", "VCS", "AHB"]));
    expect(r.skills.missingOptional).toEqual(expect.arrayContaining(["JasperGold", "PCIe"]));
    expect(r.keywordsToAdd.length).toBeGreaterThan(0);
    expect(r.yearsRequired).toBe(3);
    expect(r.score).toBeGreaterThan(55);
    expect(r.eligible).toBe(true);
  });
  it("ranks a relevant posting above an unrelated one", () => {
    const dv = scoreMatch(input());
    const sales = scoreMatch(
      input(
        {},
        {
          title: "Field Sales Executive",
          description:
            "Requirements:\n- Excel and CRM (Salesforce)\n- Two-wheeler and local language",
        },
      ),
    );
    expect(dv.score).toBeGreaterThan(sales.score + 30);
  });
  it("marks a large experience gap, excluded term or missing credential ineligible", () => {
    expect(scoreMatch(input({ candidateYears: "0" })).eligible).toBe(false);
    expect(scoreMatch(input({ exclusions: "Chipco" })).eligible).toBe(false);
    expect(scoreMatch(input({}, { requiredCredentials: "RCI" })).eligible).toBe(false);
  });
  it("does not penalise a missing salary or count it as a signal", () => {
    const r = scoreMatch(input({ minLpa: "20" }));
    expect(r.breakdown.salary).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Salary not listed/);
  });
  it("rules out senior and staff titles for freshers", () => {
    const r = scoreMatch(
      input(
        { candidateYears: "0" },
        { title: "Sr Lead Verification Engineer", description: "UVM" },
      ),
    );
    expect(r.eligible).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/staff\/lead role; you have 0 years/);
  });
  it("notes a seniority difference", () => {
    const r = scoreMatch(input({ titles: "Junior Verification Engineer" }));
    expect(r.warnings.join(" ")).toMatch(/Seniority differs/);
  });
});

describe("similarity", () => {
  it("weights rare words above boilerplate using the corpus", () => {
    const corpus = buildCorpus([
      "We are hiring engineers. Benefits, insurance, hybrid work.",
      "We are hiring engineers. Benefits, insurance, flexible hours.",
    ]);
    const boilerplate = ["benefits insurance UVM", "benefits insurance SystemVerilog"] as const;
    const rare = ["UVM testbench benefits", "UVM testbench insurance"] as const;
    // Shared boilerplate counts for less once the corpus shows it is common...
    expect(similarity(...boilerplate, corpus)).toBeLessThan(similarity(...boilerplate));
    // ...so two postings sharing rare words score above two sharing boilerplate.
    expect(similarity(...rare, corpus)).toBeGreaterThan(similarity(...boilerplate, corpus));
  });
});
