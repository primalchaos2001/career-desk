import type { Job, Workspace } from "../workspace";

/**
 * Recruiter email finder (no AI, no paid lookup service). It only reports
 * addresses that are published: in the job post itself or on the company's own
 * site (careers, jobs, contact, about pages). It never guesses addresses from
 * name patterns, so every result has a page the user can open and check.
 *
 * This file is pure (no network); server/discovery/contacts.ts fetches pages.
 */

export type FindingKind = "recruiting" | "person" | "general";

export interface Finding {
  email: string;
  kind: FindingKind;
  /** Name only when the page states it next to the address. */
  name: string;
  role: string;
  sourceUrl: string;
  /** "job post", "careers page", ... */
  source: string;
  /** Text around the address on the page, for the user to judge. */
  snippet: string;
  /** Higher is better; used for ordering only. */
  rank: number;
  note: string;
  alreadySaved: boolean;
}

export interface PageText {
  url: string;
  source: string;
  /** Plain text plus addresses from mailto links and protected-email markup. */
  text: string;
  mailtos: string[];
}

// Job boards and applicant-tracking systems: their host is not the employer's.
const BOARD_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "indeed.co.in",
  "naukri.com",
  "glassdoor.com",
  "glassdoor.co.in",
  "foundit.in",
  "monsterindia.com",
  "instahyre.com",
  "wellfound.com",
  "angel.co",
  "cutshort.io",
  "iimjobs.com",
  "hirist.tech",
  "hirist.com",
  "shine.com",
  "timesjobs.com",
  "ziprecruiter.com",
  "google.com",
  "bayt.com",
  "seek.com.au",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "ashbyhq.com",
  "bamboohr.com",
  "zohorecruit.com",
  "zohorecruit.in",
  "keka.com",
  "darwinbox.in",
  "darwinbox.com",
  "freshteam.com",
  "recruitee.com",
  "workable.com",
  "icims.com",
  "taleo.net",
  "successfactors.com",
  "oraclecloud.com",
  "jobvite.com",
  "teamtailor.com",
  "breezy.hr",
  "jazzhr.com",
  "applytojob.com",
  "superset.com",
  "unstop.com",
  "internshala.com",
];
const SOCIAL_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "github.com",
  "medium.com",
  "wikipedia.org",
  "bit.ly",
  "goo.gl",
];
const FREE_MAIL = [
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "rediffmail.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
];
const FAKE_DOMAINS = [
  "example.com",
  "example.org",
  "domain.com",
  "email.com",
  "company.com",
  "yourcompany.com",
  "yourdomain.com",
  "test.com",
  "sentry.io",
  "wixpress.com",
  "sentry-next.wixpress.com",
];

const SKIP_LOCAL =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|gdpr|dpo|legal|compliance|security|billing|invoices?|accounts?|payments?|finance|unsubscribe|webmaster|support|help|helpdesk|sales|press|media|pr|investors?|ir|grievance|complaints?|marketing|partners?|vendors?|procurement|purchase|orders?|customercare|care|service)$/;
const RECRUITING_LOCAL =
  /^(hr|hrd|hrs|hr\.?team|humanresources?|careers?|jobs?|talent|talents|recruit\w*|hiring|people|joinus|join|join\.?us|resumes?|cv|ta|apply|campus|placements?|staffing|workwithus|work\.?with\.?us)$|(^|[._-])(hr|careers?|jobs|talent|recruit\w*|hiring)([._-]|$)/;
const GENERAL_LOCAL =
  /^(info|contact|contactus|hello|hi|enquir(y|ies)|inquir(y|ies)|office|admin|team|mail)$/;
const RECRUITER_WORDS =
  /\b(recruit\w*|talent acquisition|talent partner|hiring manager|human resources|hr|people team|people partner|send (your )?(cv|resume)|share (your )?(cv|resume)|apply)\b/i;

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const within = (h: string, list: string[]) => list.some((d) => h === d || h.endsWith(`.${d}`));

/** Registrable-ish domain: last two labels, or three for co.in style suffixes. */
export function baseDomain(h: string): string {
  const parts = h
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  const two = parts.slice(-2).join(".");
  if (/^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join(".");
  return two;
}

export const isBoardHost = (url: string) => within(host(url), BOARD_HOSTS);

const companyTokens = (company: string) =>
  company
    .toLowerCase()
    .replace(
      /\b(private|pvt|ltd|limited|inc|llc|llp|corp|corporation|technologies|technology|solutions|systems|india|the|and|co)\b/g,
      " ",
    )
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

/**
 * The employer's website, when it can be read from the job itself: the saved
 * website, the job link (unless it is a job board), or a link in the posting
 * whose host contains the company's name. Never built from the name alone.
 */
export function companySite(
  job: Pick<Job, "company" | "url" | "description"> & { website?: string },
): string {
  if (job.website && host(job.website)) return origin(job.website);
  if (job.url && host(job.url) && !isBoardHost(job.url)) return origin(job.url);
  const tokens = companyTokens(job.company);
  for (const m of job.description.matchAll(
    /\bhttps?:\/\/[^\s)\]>"'<]+|\bwww\.[a-z0-9.-]+\.[a-z]{2,}[^\s)\]>"'<]*/gi,
  )) {
    const raw = m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
    const h = host(raw);
    if (!h || within(h, BOARD_HOSTS) || within(h, SOCIAL_HOSTS)) continue;
    if (tokens.some((t) => h.replace(/[^a-z0-9]/g, "").includes(t))) return origin(raw);
  }
  return "";
}

function origin(url: string) {
  const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  return `${u.protocol}//${u.hostname}`;
}

/** Pages worth reading on the company site, most useful first. */
export function sitePages(site: string): { url: string; source: string }[] {
  return [
    ["/careers", "careers page"],
    ["/jobs", "jobs page"],
    ["/careers/", "careers page"],
    ["/contact", "contact page"],
    ["/contact-us", "contact page"],
    ["/about", "about page"],
    ["/", "home page"],
  ].map(([path, source]) => ({ url: `${site}${path}`, source: source as string }));
}

/** Same-site links from a page whose path looks like careers or contact. */
export function interestingLinks(html: string, pageUrl: string): { url: string; source: string }[] {
  const out = new Map<string, string>();
  const site = host(pageUrl);
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1] ?? ""), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || baseDomain(u.hostname) !== baseDomain(site)) continue;
    const p = u.pathname.toLowerCase();
    if (
      /\.(?!html?$|php$|aspx?$)[a-z0-9]{2,5}$/.test(p) ||
      /\/wp-(content|includes|json)\//.test(p)
    )
      continue;
    const source = /career|job|join|hiring|work-with/.test(p)
      ? "careers page"
      : /contact/.test(p)
        ? "contact page"
        : /about|team|people/.test(p)
          ? "about page"
          : "";
    if (source && !out.has(`${u.origin}${u.pathname}`)) out.set(`${u.origin}${u.pathname}`, source);
  }
  return [...out].map(([url, source]) => ({ url, source }));
}

// ---------- text extraction ----------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  commat: "@",
  period: ".",
  "#64": "@",
  "#x40": "@",
  "#46": ".",
  "#x2e": ".",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k.startsWith("#x")) return String.fromCodePoint(Number.parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
    return all;
  });
}

/** Cloudflare "email protection" markup: hex string, first byte is the XOR key. */
export function decodeCfEmail(hex: string): string {
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2)
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function htmlToPage(html: string, url: string, source: string): PageText {
  const mailtos: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi))
    mailtos.push(decodeURIComponent(decodeEntities(m[1] ?? "")).trim());
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi))
    mailtos.push(decodeCfEmail(m[1] ?? ""));
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n");
  return { url, source, text, mailtos };
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;

/** Undo common hiding: "name [at] company [dot] com", "name(at)company.com". */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, ".")
    .replace(
      /([a-z0-9._-]+)\s+at\s+([a-z0-9-]+)\s+dot\s+([a-z]{2,})(?:\s+dot\s+([a-z]{2,}))?\b/gi,
      (_, a, b, c, d) => `${a}@${b}.${c}${d ? `.${d}` : ""}`,
    );
}

function clean(email: string) {
  return email
    .toLowerCase()
    .replace(/^mailto:/, "")
    .replace(/[.,;:]+$/, "");
}

function usable(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email) || /@\d+x\./.test(email)) return false;
  if (within(domain, FAKE_DOMAINS) || /^[0-9a-f]{16,}$/.test(local)) return false;
  return !SKIP_LOCAL.test(local);
}

function classify(local: string): FindingKind {
  if (RECRUITING_LOCAL.test(local)) return "recruiting";
  if (GENERAL_LOCAL.test(local)) return "general";
  return "person";
}

/** "Priya Sharma, Talent Acquisition" style names written just before the address. */
function nameNear(before: string, local: string): string {
  const parts = local.split(/[._-]/).filter((p) => p.length > 1);
  const candidates = [
    ...before.slice(-80).matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?)?(?:\s+[A-Z][a-z]+)?)\b/g),
  ]
    .map((m) => m[1] ?? "")
    .reverse();
  // Only accept a name that agrees with the address, so headings aren't read as names.
  return (
    candidates.find((n) =>
      parts.some((p) =>
        n
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.replace(".", "") === p || (p.length >= 3 && w.startsWith(p))),
      ),
    ) ?? ""
  );
}

export function emailsInPage(page: PageText): Omit<Finding, "rank" | "note" | "alreadySaved">[] {
  const text = deobfuscate(page.text);
  const out = new Map<string, Omit<Finding, "rank" | "note" | "alreadySaved">>();
  const add = (raw: string, index: number) => {
    const email = clean(raw);
    if (!usable(email) || out.has(email)) return;
    const local = email.split("@")[0] ?? "";
    const before = index >= 0 ? text.slice(Math.max(0, index - 160), index) : "";
    const after = index >= 0 ? text.slice(index + raw.length, index + raw.length + 100) : "";
    const around = `${before} ${after}`;
    const kind = classify(local);
    const recruiterContext = RECRUITER_WORDS.test(around);
    out.set(email, {
      email,
      kind,
      name: kind === "person" ? nameNear(before, local) : "",
      role:
        kind === "recruiting"
          ? "Recruiting inbox"
          : recruiterContext
            ? (
                around.match(/talent acquisition|recruiter|human resources|hr manager|hr/i)?.[0] ??
                "Recruiting"
              )
                .replace(/^hr$/i, "HR")
                .replace(/^\w/, (c) => c.toUpperCase())
            : "",
      sourceUrl: page.url,
      source: page.source,
      snippet:
        index >= 0
          ? `${before.slice(-80)}${raw}${after.slice(0, 60)}`.replace(/\s+/g, " ").trim()
          : "",
    });
  };
  for (const m of text.matchAll(EMAIL)) add(m[0], m.index ?? -1);
  for (const m of page.mailtos) {
    const i = text.toLowerCase().indexOf(m.toLowerCase());
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(m)) add(m, i);
  }
  return [...out.values()];
}

/**
 * Rank addresses from all pages read for one job. Addresses on the company's
 * site must use its domain; free-mail addresses count only in the job post.
 */
export function rankFindings(
  w: Workspace,
  site: string,
  pages: PageText[],
  /** Other domains the site redirected to (rebrands, group sites). */
  alsoOwn: string[] = [],
): Finding[] {
  const companyDomain = site ? baseDomain(host(site)) : "";
  const owned = new Set([companyDomain, ...alsoOwn].filter(Boolean));
  const saved = new Set((w.contacts ?? []).map((c) => c.email.toLowerCase()));
  const best = new Map<string, Finding>();
  for (const page of pages) {
    const inPost = page.source === "job post";
    for (const f of emailsInPage(page)) {
      const domain = f.email.split("@")[1] ?? "";
      const free = within(domain, FREE_MAIL);
      const own = owned.has(baseDomain(domain));
      if (!inPost && !own) continue;
      let rank = { recruiting: 60, person: 50, general: 20 }[f.kind];
      if (inPost) rank += 30;
      if (f.role && f.kind === "person") rank += 15;
      if (own) rank += 10;
      if (free) rank -= 25;
      const notes: string[] = [];
      if (free) notes.push("Personal mail address. Check it really belongs to the employer.");
      if (!own && !free && companyDomain) notes.push(`Not the ${companyDomain} domain.`);
      if (f.kind === "general")
        notes.push("General inbox; your email may be forwarded or ignored.");
      if (f.kind === "person" && !f.role)
        notes.push("A person's address; the page doesn't say they hire.");
      const finding: Finding = {
        ...f,
        rank,
        note: notes.join(" "),
        alreadySaved: saved.has(f.email),
      };
      const prev = best.get(f.email);
      if (!prev || prev.rank < rank) best.set(f.email, finding);
    }
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank);
}
