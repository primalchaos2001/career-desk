import type { ProjectEnrichment, ResumeDoc } from "../resume.js";

/**
 * GitHub enrichment (O-05, ARCHITECTURE §1 stage 5): verify project claims
 * with public repo data. Browser-direct REST (api.github.com sends CORS
 * headers), no key needed; optional PAT raises the rate limit. Every failure
 * is non-fatal: the project is skipped and a human-readable note recorded —
 * the pipeline must produce a report with or without GitHub (D-011).
 */

export interface GithubEnrichOptions {
  /** optional personal access token (rate limit 60/h → 5000/h) */
  pat?: string;
  fetch?: typeof fetch;
  /** override for tests/self-hosting */
  apiBase?: string;
}

export interface GithubEnrichResult {
  doc: ResumeDoc;
  /** skipped repos, rate limits, mismatches — surfaced in the report UI */
  notes: string[];
}

const REPO_URL = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|\/)?$/i;
const PROFILE_URL = /github\.com\/([\w-]+)\/?$/i;

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(REPO_URL);
  return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}

/** candidate's GitHub login, from their profile link */
export function candidateLogin(doc: ResumeDoc): string | null {
  for (const profile of doc.basics.profiles) {
    if (profile.network.toLowerCase() !== "github" || !profile.url) continue;
    const m = profile.url.match(PROFILE_URL);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function enrichGithub(
  doc: ResumeDoc,
  opts: GithubEnrichOptions = {},
): Promise<GithubEnrichResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const apiBase = (opts.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    ...(opts.pat ? { authorization: `Bearer ${opts.pat}` } : {}),
  };
  const login = candidateLogin(doc);
  const notes: string[] = [];

  const projects = await Promise.all(
    doc.projects.map(async (project) => {
      if (!project.githubUrl) return project;
      const parsed = parseRepoUrl(project.githubUrl);
      if (!parsed) {
        notes.push(`${project.name}: could not parse GitHub URL "${project.githubUrl}"`);
        return project;
      }
      const repoPath = `${apiBase}/repos/${parsed.owner}/${parsed.repo}`;
      try {
        const repoRes = await doFetch(repoPath, { headers });
        if (!repoRes.ok) {
          notes.push(
            repoRes.status === 403 || repoRes.status === 429
              ? `${project.name}: GitHub rate limit reached — enrichment skipped (add a PAT to raise the limit)`
              : `${project.name}: repo lookup failed (HTTP ${repoRes.status})`,
          );
          return project;
        }
        const repo = (await repoRes.json()) as {
          stargazers_count?: number;
          pushed_at?: string;
        };

        const enrichment: ProjectEnrichment = { languages: [] };
        if (typeof repo.stargazers_count === "number") enrichment.stars = repo.stargazers_count;
        if (repo.pushed_at) enrichment.lastActivity = repo.pushed_at.slice(0, 7);

        const langRes = await doFetch(`${repoPath}/languages`, { headers });
        if (langRes.ok) {
          const langs = (await langRes.json()) as Record<string, number>;
          enrichment.languages = Object.entries(langs)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);
        }

        const contribRes = await doFetch(`${repoPath}/contributors?per_page=100`, { headers });
        if (contribRes.ok) {
          const contributors = (await contribRes.json()) as {
            login?: string;
            contributions?: number;
          }[];
          const total = contributors.reduce((n, c) => n + (c.contributions ?? 0), 0);
          if (total > 0) enrichment.totalCommits = total;
          if (login) {
            const own = contributors.find(
              (c) => c.login?.toLowerCase() === login.toLowerCase(),
            )?.contributions;
            if (own !== undefined) enrichment.candidateCommits = own;
            else notes.push(`${project.name}: "${login}" is not among the repo's contributors`);
          }
        }

        return { ...project, enrichment };
      } catch (e) {
        notes.push(
          `${project.name}: enrichment failed (${e instanceof Error ? e.message : "network error"})`,
        );
        return project;
      }
    }),
  );

  return { doc: { ...doc, projects }, notes };
}
