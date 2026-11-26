import { describe, expect, it } from "vitest";
import { type Fetcher, findContacts, robotsRules } from "../server/discovery/contacts";
import {
  companySite,
  decodeCfEmail,
  deobfuscate,
  htmlToPage,
  rankFindings,
} from "../src/lib/contacts/finder";
import { blankWorkspace, type Job, type Workspace } from "../src/lib/workspace";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    campaignId: "c1",
    company: "Chipco Technologies Pvt Ltd",
    title: "Design Verification Engineer",
    url: "https://www.linkedin.com/jobs/view/123",
    location: "Bengaluru",
    description:
      "UVM and SystemVerilog. Share your CV with Priya Sharma, Talent Acquisition: priya.sharma@chipco.com",
    salaryLpa: "",
    minExperience: "",
    requiredCredentials: "",
    requiredLanguages: "",
    website: "",
    notes: "",
    createdAt: new Date().toISOString(),
    verifiedAt: "",
    archived: false,
    ...over,
  };
}

function workspace(): Workspace {
  const w = blankWorkspace();
  w.campaigns.push({ ...(w.campaigns[0] ?? ({} as Workspace["campaigns"][number])), id: "c1" });
  return w;
}

describe("finding the employer's site", () => {
  it("uses the job link unless it is a job board", () => {
    expect(companySite(job({ url: "https://careers.chipco.com/jobs/9" }))).toBe(
      "https://careers.chipco.com",
    );
    expect(companySite(job({ description: "" }))).toBe("");
  });
  it("accepts a link in the post only when it names the company", () => {
    expect(
      companySite(job({ description: "Visit www.chipco.com and https://twitter.com/x" })),
    ).toBe("https://www.chipco.com");
    expect(companySite(job({ description: "Built on https://aws.amazon.com" }))).toBe("");
  });
});

describe("reading addresses", () => {
  it("undoes common hiding", () => {
    expect(deobfuscate("hr [at] chipco [dot] com")).toBe("hr@chipco.com");
    expect(deobfuscate("careers(at)chipco.co.in")).toBe("careers@chipco.co.in");
    expect(deobfuscate("jobs at chipco dot com")).toBe("jobs@chipco.com");
  });
  it("decodes Cloudflare-protected addresses and mailto links", () => {
    // "hr@x.io" XOR 0x42
    const hex = `42${[..."hr@x.io"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("")}`;
    expect(decodeCfEmail(hex)).toBe("hr@x.io");
    const page = htmlToPage(
      `<a href="mailto:talent@chipco.com?subject=CV">Email us</a><span data-cfemail="${hex}"></span><script>var a="x@sentry.io"</script>`,
      "https://chipco.com/careers",
      "careers page",
    );
    expect(page.mailtos).toEqual(["talent@chipco.com", "hr@x.io"]);
    expect(page.text).not.toContain("sentry");
  });
});

describe("ranking", () => {
  it("puts a named recruiter in the post first and drops off-site and no-reply addresses", () => {
    const w = workspace();
    const found = rankFindings(w, "https://chipco.com", [
      {
        url: "https://www.linkedin.com/jobs/view/123",
        source: "job post",
        text: job().description,
        mailtos: [],
      },
      htmlToPage(
        "<p>Careers: careers@chipco.com</p><p>noreply@chipco.com support@chipco.com info@chipco.com</p><p>Our agency: hello@vendor.com</p><img src='logo@2x.png'>",
        "https://chipco.com/careers",
        "careers page",
      ),
    ]);
    expect(found.map((f) => f.email)).toEqual([
      "priya.sharma@chipco.com",
      "careers@chipco.com",
      "info@chipco.com",
    ]);
    expect(found[0]).toMatchObject({
      kind: "person",
      name: "Priya Sharma",
      role: "Talent Acquisition",
    });
    expect(found[2]?.note).toMatch(/General inbox/);
  });
  it("warns about personal mail and marks saved contacts", () => {
    const w = workspace();
    w.contacts.push({
      id: "k1",
      campaignId: "c1",
      company: "Chipco",
      name: "",
      role: "",
      email: "hr@chipco.com",
      sourceUrl: "https://chipco.com/careers",
      notes: "",
      doNotContact: false,
      createdAt: new Date().toISOString(),
    });
    const found = rankFindings(w, "", [
      {
        url: "https://x.test/job",
        source: "job post",
        text: "Send CV to chipcohr@gmail.com or HR@chipco.com",
        mailtos: [],
      },
    ]);
    expect(found.find((f) => f.email === "chipcohr@gmail.com")?.note).toMatch(/Personal mail/);
    expect(found.find((f) => f.email === "hr@chipco.com")?.alreadySaved).toBe(true);
  });
});

describe("robots.txt", () => {
  it("reads rules for all robots", () => {
    expect(
      robotsRules(
        "User-agent: Googlebot\nDisallow: /a\n\nUser-agent: *\nDisallow: /private\nDisallow:\n",
      ),
    ).toEqual(["/private"]);
  });
});

describe("findContacts", () => {
  it("reads the employer's pages, follows careers links and respects robots.txt", async () => {
    const pages: Record<string, string> = {
      "https://chipco.com/robots.txt": "User-agent: *\nDisallow: /contact",
      "https://chipco.com/": '<a href="/join-us">Join us</a><a href="/contact">Contact</a>',
      "https://chipco.com/join-us": "<p>Write to recruitment@chipco.com</p>",
    };
    const asked: string[] = [];
    const fetcher: Fetcher = async (url) => {
      asked.push(url);
      const html = pages[url];
      return html === undefined ? { error: "HTTP 404" } : { url, html };
    };
    const r = await findContacts(workspace(), job({ website: "https://chipco.com" }), {
      fetcher,
      mx: async () => true,
    });
    expect(asked).not.toContain("https://chipco.com/contact");
    expect(asked).toContain("https://chipco.com/join-us");
    expect(r.findings.map((f) => f.email)).toEqual([
      "priya.sharma@chipco.com",
      "recruitment@chipco.com",
    ]);
    expect(r.findings[1]).toMatchObject({
      source: "careers page",
      sourceUrl: "https://chipco.com/join-us",
    });
    expect(r.acceptsMail).toBe(true);
    expect(asked.some((u) => u.includes("linkedin"))).toBe(false);
  });
  it("explains what to do when the site is unknown", async () => {
    const r = await findContacts(workspace(), job({ description: "UVM" }), {
      fetcher: async () => ({ error: "x" }),
      mx: async () => null,
    });
    expect(r.findings).toEqual([]);
    expect(r.advice).toMatch(/website isn't known/);
  });
});
