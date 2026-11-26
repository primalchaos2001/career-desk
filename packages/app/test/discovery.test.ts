import { describe, expect, it } from "vitest";
import { searchBoards } from "../server/discovery/jobspy";
import { type BoardPosting, lpaOf, searchTerms, toJobInput } from "../src/lib/boards";
import { addJob, blankWorkspace, type Workspace } from "../src/lib/workspace";

function workspace(): Workspace {
  const w = blankWorkspace();
  w.profile.skills = "SystemVerilog, UVM, SVA, Python";
  w.profile.experienceYears = "2";
  w.campaigns.push({
    id: "c1",
    name: "DV Bengaluru",
    track: "other",
    titles: "Design Verification Engineer, ASIC Verification Engineer",
    locations: "Bengaluru",
    keywords: "",
    exclusions: "",
    minLpa: "",
    maxLpa: "",
    mode: "research",
    templateId: "cover",
    notes: "",
    createdAt: new Date().toISOString(),
  });
  return w;
}

const post = (over: Partial<BoardPosting>): BoardPosting => ({
  site: "indeed",
  title: "Design Verification Engineer",
  company: "Chipco",
  location: "Bengaluru, KA, India",
  job_url: "https://in.indeed.com/viewjob?jk=1",
  description: "Requirements: SystemVerilog, UVM, SVA. 2+ years of experience.",
  ...over,
});

describe("job-board adapter", () => {
  it("maps a posting into an unverified job with INR pay in LPA", () => {
    const j = toJobInput(
      post({
        min_amount: 150_000,
        interval: "monthly",
        currency: "INR",
        experience_range: "2-5 Yrs",
      }),
      "c1",
    );
    expect(j.salaryLpa).toBe("18");
    expect(j.minExperience).toBe("2");
    expect(j.notes).toMatch(/Not yet checked/);
    expect(lpaOf(post({ min_amount: 100_000, currency: "USD" }))).toBe("");
  });

  it("uses up to three target titles as search terms", () => {
    expect(searchTerms(workspace().campaigns[0] as never)).toEqual([
      "Design Verification Engineer",
      "ASIC Verification Engineer",
    ]);
  });

  it("ranks results, removes cross-board duplicates and flags saved jobs", async () => {
    const w = workspace();
    addJob(w, {
      ...toJobInput(post({ job_url: "https://example.com/saved" }), "c1"),
      title: "Old",
    });
    const calls: unknown[] = [];
    const fake = (async (_script: string, input: unknown) => {
      calls.push(input);
      return {
        errors: [{ site: "naukri", error: "blocked" }],
        jobs: [
          post({
            title: "Sales Executive",
            company: "Shop",
            job_url: "https://x.com/1",
            description: "Excel",
          }),
          post({}),
          post({ site: "linkedin", job_url: "https://linkedin.com/jobs/view/9" }), // same job, other board
          post({ title: "UVM Engineer", company: "Other", job_url: "https://example.com/saved" }),
        ],
      };
    }) as never;
    const { candidates, errors } = await searchBoards(w, { campaignId: "c1" }, fake);
    expect(calls).toHaveLength(2);
    expect(errors.length).toBe(2);
    expect(candidates.map((c) => c.job.company)).toEqual(["Chipco", "Other", "Shop"]);
    expect(candidates[0]?.match.skills.matched).toEqual(expect.arrayContaining(["UVM"]));
    expect(candidates.find((c) => c.job.company === "Other")?.alreadySaved).toBe(true);
  });
});
