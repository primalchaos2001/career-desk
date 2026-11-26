import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResumeDoc } from "@tailorats/core";
import { describe, expect, it } from "vitest";
import { runDueSearches } from "../server/scheduler";
import type { BoardPosting } from "../src/lib/boards";
import { quickStartCampaign, skillsFromCv, yearsFromWork } from "../src/lib/onboarding";
import { addContact, approveOutreach, draftOutreach } from "../src/lib/outreach";
import {
  extendSchedule,
  isDue,
  localDay,
  needsExtension,
  scheduleState,
  startSchedule,
} from "../src/lib/schedule";
import { blankWorkspace, type Campaign, type Workspace } from "../src/lib/workspace";

const at = (s: string) => new Date(s); // local time
function campaign(w: Workspace): Campaign {
  return quickStartCampaign(w, {
    role: "Design Verification Engineer",
    city: "Bengaluru",
    expectedLpa: "18",
  });
}

describe("morning search schedule", () => {
  it("runs daily at 9 for the first week, then needs the user's OK", () => {
    const c = campaign(blankWorkspace());
    startSchedule(c, at("2026-11-26T08:00:00"));
    expect(c.schedule?.until).toBe("2026-12-02");
    expect(isDue(c, at("2026-11-26T08:59:00"))).toBe(false);
    expect(isDue(c, at("2026-11-26T09:00:00"))).toBe(true);
    if (c.schedule) c.schedule.lastRunDay = "2026-11-26";
    expect(isDue(c, at("2026-11-26T15:00:00"))).toBe(false);
    expect(isDue(c, at("2026-11-27T10:00:00"))).toBe(true);
    expect(needsExtension(c, at("2026-12-01T10:00:00"))).toBe(false);
    expect(needsExtension(c, at("2026-12-02T10:00:00"))).toBe(true);
    expect(isDue(c, at("2026-12-03T10:00:00"))).toBe(false);
    expect(scheduleState(c, at("2026-12-03T10:00:00")).kind).toBe("ended");
  });

  it("extends by three days from the end, or from today once ended", () => {
    const c = campaign(blankWorkspace());
    startSchedule(c, at("2026-11-26T08:00:00"));
    extendSchedule(c, at("2026-12-02T10:00:00"));
    expect(c.schedule?.until).toBe("2026-12-05");
    extendSchedule(c, at("2026-12-20T10:00:00"));
    expect(c.schedule?.until).toBe("2026-12-22");
    expect(c.schedule?.extensions).toBe(2);
  });
});

describe("first-run helpers", () => {
  it("creates the first campaign from role, city and expected salary", () => {
    const w = blankWorkspace();
    const c = campaign(w);
    expect(c).toMatchObject({
      titles: "Design Verification Engineer",
      locations: "Bengaluru",
      minLpa: "18",
      mode: "draft",
    });
    expect(w.profile.expectedLpa).toBe("18");
  });

  it("reads skills and years of experience from the CV", () => {
    const doc = {
      work: [
        {
          name: "A",
          position: "Engineer",
          startDate: "2022-01",
          endDate: "2023-12",
          highlights: [],
        },
        {
          name: "B",
          position: "Engineer",
          startDate: "2023-06",
          endDate: "2024-12",
          highlights: [],
        },
        {
          name: "C",
          position: "Summer Intern",
          startDate: "2021-05",
          endDate: "2021-07",
          highlights: [],
        },
      ],
      skills: [{ name: "HDL", keywords: ["SystemVerilog"] }],
    } as unknown as ResumeDoc;
    expect(yearsFromWork(doc)).toBe("3");
    const skills = skillsFromCv("Built UVM testbenches in Python", doc);
    expect(skills[0]).toBe("SystemVerilog");
    expect(skills).toEqual(expect.arrayContaining(["Python", "UVM"]));
  });
});

describe("email responsibility", () => {
  function setup() {
    const w = blankWorkspace();
    w.profile.name = "Asha";
    w.profile.email = "asha@example.com";
    const c = campaign(w);
    const contact = addContact(w, {
      campaignId: c.id,
      company: "Chipco",
      email: "hr@chipco.example",
      sourceUrl: "https://chipco.example/careers",
      name: "",
      role: "",
      notes: "",
    } as never);
    return { w, contact };
  }
  it("won't draft from the starter template until the user owns it", () => {
    const { w, contact } = setup();
    expect(() => draftOutreach(w, contact.id)).toThrow(/starter text/);
    const o = draftOutreach(w, contact.id, { body: "Hello, I am Asha." });
    expect(o.origin).toBe("assistant");
  });
  it("needs the user's review confirmation to approve", () => {
    const { w, contact } = setup();
    const o = draftOutreach(w, contact.id, { body: "Hello, I am Asha." });
    expect(() => approveOutreach(w, o.id, { reviewed: false })).toThrow(/you are the one sending/);
    approveOutreach(w, o.id, { reviewed: true });
    expect(o.status).toBe("approved");
  });
});

describe("scheduler", () => {
  it("runs a due campaign once a day and saves good, eligible matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cd-sched-"));
    const w = blankWorkspace();
    w.profile.skills = "SystemVerilog, UVM, SVA";
    w.profile.experienceYears = "2";
    const c = campaign(w);
    startSchedule(c, at("2026-11-26T08:00:00"));
    writeFileSync(join(dir, "workspace.json"), JSON.stringify(w));
    const post = (n: number, title: string, description: string): BoardPosting => ({
      site: "indeed",
      title,
      company: `Co${n}`,
      location: "Bengaluru",
      job_url: `https://jobs.example/${n}`,
      description,
    });
    const search = async () => ({
      errors: [],
      jobs: [
        post(
          1,
          "Design Verification Engineer",
          "Requirements: SystemVerilog, UVM, SVA. 2+ years experience.",
        ),
        post(2, "Sales Executive", "Excel, field sales"),
      ],
    });
    const assistant: string[] = [];
    const opts = {
      dir,
      mcpBundle: "",
      search,
      startAssistant: (id: string) => assistant.push(id),
      clock: () => at("2026-11-26T09:05:00"),
    };
    expect(await runDueSearches(opts)).toEqual([c.id]);
    expect(await runDueSearches(opts)).toEqual([]);
    const saved = JSON.parse(readFileSync(join(dir, "workspace.json"), "utf8")) as Workspace;
    expect(saved.jobs.map((j) => j.company)).toEqual(["Co1"]);
    expect(saved.campaigns[0]?.schedule?.lastRunDay).toBe(localDay(at("2026-11-26T09:05:00")));
    expect(saved.campaigns[0]?.schedule?.lastResult).toMatch(/1 new match saved from 2 postings/);
    expect(assistant).toEqual([]); // assistant search is off unless the user turns it on
  });
});
