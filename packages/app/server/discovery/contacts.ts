import { lookup, resolveMx } from "node:dns/promises";
import { isIP } from "node:net";
import {
  baseDomain,
  companySite,
  type Finding,
  htmlToPage,
  interestingLinks,
  isBoardHost,
  type PageText,
  rankFindings,
  sitePages,
} from "../../src/lib/contacts/finder";
import type { Job, Workspace } from "../../src/lib/workspace";

/**
 * Reads the public pages the finder needs: the job post (when it isn't a job
 * board, whose terms usually forbid automated reading) and a few pages of the
 * employer's own site. Plain GET requests, robots.txt respected, private and
 * local network addresses refused, at most MAX_PAGES pages per job.
 */

const MAX_PAGES = 10;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "CareerDesk/0.1 (personal job-search tool; reads public careers pages)";

export interface ContactSearch {
  jobId: string;
  company: string;
  site: string;
  /** Whether the site's domain is set up to receive email (MX record). */
  acceptsMail: boolean | null;
  pagesRead: { url: string; source: string; ok: boolean; note?: string }[];
  findings: Finding[];
  advice: string;
}

export type Fetcher = (url: string) => Promise<{ url: string; html: string } | { error: string }>;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80") ||
      v === "::" ||
      v.startsWith("::ffff:127.") ||
      v.startsWith("::ffff:10.") ||
      v.startsWith("::ffff:192.168.")
    );
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function publicHost(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
    return false;
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

/** Default fetcher: public http(s) only, follows redirects one hop at a time. */
export const httpFetch: Fetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { error: "Not a web page" };
    if (!(await publicHost(u.hostname))) return { error: "Not a public address" };
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { error: (e as Error).name === "TimeoutError" ? "Timed out" : "Could not connect" };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location") as string, url).toString();
      continue;
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|text\/plain/.test(type)) return { error: "Not a web page" };
    const reader = res.body?.getReader();
    if (!reader) return { error: "Empty page" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    return { url, html: Buffer.concat(chunks).toString("utf8") };
  }
  return { error: "Too many redirects" };
};

/** Disallow rules for all robots ("User-agent: *") from a robots.txt. */
export function robotsRules(txt: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key = "", ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const k = key.toLowerCase();
    if (k === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*" || /careerdesk/i.test(value)) applies = true;
    } else {
      inAgents = false;
      if (applies && k === "disallow" && value) rules.push(value);
    }
  }
  return rules;
}

const allowed = (rules: string[], path: string) =>
  !rules.some((r) => {
    const re = new RegExp(
      `^${r
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$")}`,
    );
    return re.test(path);
  });

export async function findContacts(
  w: Workspace,
  job: Job,
  opts: {
    website?: string;
    fetcher?: Fetcher;
    mx?: (domain: string) => Promise<boolean | null>;
  } = {},
): Promise<ContactSearch> {
  const fetcher = opts.fetcher ?? httpFetch;
  const site = companySite({ ...job, website: opts.website ?? job.website });
  const pages: PageText[] = [
    // The saved description is always available and needs no request.
    { url: job.url, source: "job post", text: `${job.title}\n${job.description}`, mailtos: [] },
  ];
  const pagesRead: ContactSearch["pagesRead"] = [];
  const tried = new Set<string>();
  const read = async (url: string, source: string, rules: string[]) => {
    const key = url.replace(/\/$/, "");
    if (pagesRead.length >= MAX_PAGES || tried.has(key)) return undefined;
    tried.add(key);
    if (!allowed(rules, new URL(url).pathname)) {
      pagesRead.push({
        url,
        source,
        ok: false,
        note: "The site asks robots not to read this page",
      });
      return undefined;
    }
    const r = await fetcher(url);
    if ("error" in r) {
      pagesRead.push({ url, source, ok: false, note: r.error });
      return undefined;
    }
    // Several paths often redirect to the same page; read it once.
    const final = r.url.replace(/\/$/, "");
    if (final !== key && tried.has(final)) return undefined;
    tried.add(final);
    // A careers link that lands on the home page is the home page.
    const label = source !== "job post" && new URL(r.url).pathname === "/" ? "home page" : source;
    pagesRead.push({ url: r.url, source: label, ok: true });
    pages.push(htmlToPage(r.html, r.url, label));
    return r.html;
  };

  // The live job post, when it is on the employer's own site or careers system.
  if (job.url && !isBoardHost(job.url)) await read(job.url, "job post", []);
  else if (
    job.url &&
    /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com/.test(
      job.url,
    )
  )
    await read(job.url, "job post", []);

  if (site) {
    const robots = await fetcher(`${site}/robots.txt`);
    const rules = "error" in robots ? [] : robotsRules(robots.html);
    const queue = sitePages(site);
    for (let i = 0; i < queue.length && pagesRead.length < MAX_PAGES; i++) {
      const next = queue[i];
      if (!next) break;
      const html = await read(next.url, next.source, rules);
      // The home page links to the real careers and contact pages.
      if (html && next.source === "home page")
        for (const link of interestingLinks(html, next.url))
          if (!queue.some((q) => q.url === link.url)) queue.push(link);
    }
  }

  // A site that redirects elsewhere (a rebrand, a group domain) owns that domain too.
  const siteDomains = pagesRead
    .filter((p) => p.ok && p.source !== "job post")
    .map((p) => baseDomain(new URL(p.url).hostname));
  const findings = rankFindings(w, site, pages, siteDomains);
  const domain = site ? baseDomain(new URL(site).hostname) : "";
  const mx = opts.mx ?? defaultMx;
  const acceptsMail = domain ? await mx(domain) : null;
  return {
    jobId: job.id,
    company: job.company,
    site,
    acceptsMail,
    pagesRead,
    findings,
    advice: advice(findings, site),
  };
}

async function defaultMx(domain: string) {
  try {
    return (await resolveMx(domain)).length > 0;
  } catch {
    return false;
  }
}

function advice(findings: Finding[], site: string) {
  if (!site && !findings.length)
    return "This job came from a job board, so the company's website isn't known. Add it (for example https://company.com) and search again, or apply through the listing.";
  if (!findings.length)
    return "No published email found. Apply through the listing, or look for a recruiter's address on the company's careers page yourself and add it with its link.";
  if (!findings.some((f) => f.kind !== "general"))
    return "Only a general inbox is published. It may reach HR, but applying through the listing is usually better.";
  return "Check each address on its page before saving. Only email addresses published for this purpose.";
}
