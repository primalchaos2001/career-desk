import type { MatchResult } from "./match/matcher";
import { plainText } from "./text";
import {
  type Campaign,
  canonicalUrl,
  type JobInput,
  jobCorpus,
  matchJob,
  type Workspace,
} from "./workspace";

/**
 * Job-board leads from JobSpy (MIT, https://github.com/speedyapply/JobSpy).
 * The local server runs JobSpy (server/discovery/jobspy.ts); this module maps
 * its postings into Career Desk jobs and ranks them with the smart matcher, so
 * the app and the assistant connector rank leads the same way. Leads are
 * unverified until someone checks the live listing.
 */

export const BOARD_SITES = ["linkedin", "indeed", "naukri", "glassdoor", "google"] as const;
export type BoardSite = (typeof BOARD_SITES)[number];

export interface BoardSearch {
  campaignId: string;
  sites?: BoardSite[];
  /** Per site and search term. */
  resultsPerSite?: number;
  hoursOld?: number;
  /** Fetch full descriptions (slower, much better matching). */
  fetchDescriptions?: boolean;
}

export interface BoardPosting {
  site: string;
  title: string;
  company?: string;
  location?: string;
  job_url: string;
  job_url_direct?: string | null;
  description?: string | null;
  date_posted?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  currency?: string | null;
  interval?: string | null;
  experience_range?: string | null;
  is_remote?: boolean | null;
  /** Employer's own website, when the board lists it (Indeed often does). */
  company_url_direct?: string | null;
}

export type BoardError = { site: string; error: string };

export interface Candidate {
  job: JobInput;
  site: string;
  datePosted: string;
  match: MatchResult;
  alreadySaved: boolean;
}

/** Yearly INR pay to lakh per annum, or "" when the posting does not say. */
export function lpaOf(p: BoardPosting): string {
  if (!p.min_amount || (p.currency && p.currency.toUpperCase() !== "INR")) return "";
  const perYear: Record<string, number> = {
    yearly: 1,
    monthly: 12,
    weekly: 52,
    daily: 260,
    hourly: 2080,
  };
  const factor = perYear[(p.interval ?? "yearly").toLowerCase()];
  if (!factor) return "";
  return String(Math.round(((p.min_amount * factor) / 100_000) * 10) / 10);
}

export function toJobInput(p: BoardPosting, campaignId: string): JobInput {
  const years = p.experience_range?.match(/\d+/)?.[0] ?? "";
  return {
    campaignId,
    company: (p.company || "Unknown employer").slice(0, 200),
    title: p.title.slice(0, 200),
    url: p.job_url_direct || p.job_url,
    location: (p.location || (p.is_remote ? "Remote" : "")).slice(0, 2000),
    description: plainText(p.description ?? "").slice(0, 100_000),
    salaryLpa: lpaOf(p),
    minExperience: years,
    requiredCredentials: "",
    requiredLanguages: "",
    website: /^https?:\/\//i.test(p.company_url_direct ?? "") ? (p.company_url_direct ?? "") : "",
    notes: `Found on ${p.site} via job-board search${p.date_posted ? `, posted ${p.date_posted}` : ""}. Not yet checked on the live listing.`,
  };
}

/** Search terms from the campaign's target titles (at most three searches). */
export function searchTerms(c: Campaign): string[] {
  const titles = c.titles
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return (titles.length ? titles : [c.name]).slice(0, 3);
}

/** What the local server needs to run one board search. */
export function boardQueries(c: Campaign, opts: Omit<BoardSearch, "campaignId"> = {}) {
  const location = c.locations.split(/[,;\n]/)[0]?.trim() ?? "";
  return searchTerms(c).map((term) => ({
    search_term: term,
    location,
    sites: opts.sites?.length ? opts.sites : ["linkedin", "indeed", "naukri"],
    results_wanted: opts.resultsPerSite ?? 15,
    hours_old: opts.hoursOld ?? 24 * 14,
    country_indeed: "india",
    fetch_description: opts.fetchDescriptions ?? true,
  }));
}

/** Map, de-duplicate across boards and rank postings for a campaign. */
export function rankPostings(
  w: Workspace,
  campaignId: string,
  postings: BoardPosting[],
): Candidate[] {
  const c = w.campaigns.find((x) => x.id === campaignId);
  if (!c) throw new Error("Campaign not found");
  const saved = new Set(w.jobs.map((j) => canonicalUrl(j.url)));
  const seen = new Set<string>();
  const corpus = jobCorpus(w);
  const candidates: Candidate[] = [];
  for (const p of postings) {
    let url: string;
    try {
      url = canonicalUrl(p.job_url_direct || p.job_url);
    } catch {
      continue;
    }
    // The same opening is often listed on several boards.
    const key = `${(p.company ?? "").toLowerCase()}|${p.title.toLowerCase()}`;
    if (seen.has(url) || seen.has(key)) continue;
    seen.add(url);
    seen.add(key);
    const job = toJobInput(p, c.id);
    const match = matchJob(
      w.profile,
      c,
      {
        ...job,
        website: job.website ?? "",
        id: "",
        createdAt: "",
        verifiedAt: "",
        archived: false,
      },
      corpus,
    );
    candidates.push({
      job,
      site: p.site,
      datePosted: p.date_posted ?? "",
      match,
      alreadySaved: saved.has(url),
    });
  }
  return candidates.sort((a, b) => b.match.score - a.match.score);
}
