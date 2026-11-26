import { type BoardPosting, boardQueries, rankPostings } from "../src/lib/boards";
import { isDue, localDay } from "../src/lib/schedule";
import { addJob, event, now, validateWorkspace, type Workspace } from "../src/lib/workspace";
import { runBoardQueries } from "./discovery/python";
import { readState, writeIfRevision } from "./folderFile";
import { currentRun, startRun } from "./runner";

/**
 * Runs each campaign's morning search while Career Desk is open (launcher only).
 * Job boards (JobSpy) cost nothing. If the user also allowed their assistant,
 * a research-only Find jobs run starts as well, which uses their plan allowance.
 * Saved leads are unverified; nothing is applied for or sent.
 */

/** Saved per morning, at most. */
export const DAILY_SAVE_LIMIT = 10;
/** Leads below this match score are not saved automatically. */
export const AUTO_SAVE_SCORE = 55;

export interface SchedulerOptions {
  dir: string;
  mcpBundle: string;
  nodePath?: string;
  /** Tests: replace the job-board call. */
  search?: (queries: unknown[]) => Promise<{ jobs: BoardPosting[]; errors: { site: string }[] }>;
  /** Tests: replace the assistant run. */
  startAssistant?: (campaignId: string) => void;
  clock?: () => Date;
}

function change(dir: string, fn: (w: Workspace) => void): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = readState(dir);
    if (!("exists" in state) || !state.exists) return false;
    const current = validateWorkspace(state.value);
    const next = structuredClone(current);
    fn(next);
    next.revision = current.revision + 1;
    next.updatedAt = now();
    const saved = writeIfRevision(dir, current.revision, validateWorkspace(next));
    if ("ok" in saved) return true;
    if ("error" in saved) throw new Error(saved.error);
  }
  return false;
}

/** Run every campaign that is due now. Returns the campaigns it ran. */
export async function runDueSearches(opts: SchedulerOptions): Promise<string[]> {
  const clock = opts.clock ?? (() => new Date());
  const state = readState(opts.dir);
  if (!("exists" in state) || !state.exists) return [];
  let w: Workspace;
  try {
    w = validateWorkspace(state.value);
  } catch {
    return [];
  }
  const ran: string[] = [];
  for (const c of w.campaigns.filter((x) => isDue(x, clock()))) {
    const today = localDay(clock());
    // Claim today's run first, so a restart or a second window can't repeat it.
    let claimed = false;
    try {
      claimed = change(opts.dir, (next) => {
        const s = next.campaigns.find((x) => x.id === c.id)?.schedule;
        if (!s || s.lastRunDay === today) throw new Error("already claimed");
        s.lastRunDay = today;
        s.lastResult = "Searching job boards…";
      });
    } catch {
      claimed = false;
    }
    if (!claimed) continue;
    ran.push(c.id);
    let result: string;
    try {
      const search = opts.search ?? ((q: unknown[]) => runBoardQueries(q));
      const { jobs, errors } = await search(boardQueries(c));
      const latest = validateWorkspace((readState(opts.dir) as { value: unknown }).value);
      const picks = rankPostings(latest, c.id, jobs)
        .filter((x) => !x.alreadySaved && x.match.eligible && x.match.score >= AUTO_SAVE_SCORE)
        .slice(0, DAILY_SAVE_LIMIT);
      let saved = 0;
      change(opts.dir, (next) => {
        saved = 0;
        for (const p of picks)
          try {
            addJob(next, p.job);
            saved++;
          } catch {
            // already saved meanwhile
          }
        const s = next.campaigns.find((x) => x.id === c.id)?.schedule;
        result = `${saved} new match${saved === 1 ? "" : "es"} saved from ${jobs.length} postings${
          errors.length ? `; ${errors.map((e) => e.site).join(", ")} did not answer` : ""
        }`;
        if (s) s.lastResult = result;
        event(next, `Morning search for ${c.name}: ${result}`);
      });
    } catch (e) {
      result = `Morning search failed: ${(e as Error).message}`.slice(0, 500);
      change(opts.dir, (next) => {
        const s = next.campaigns.find((x) => x.id === c.id)?.schedule;
        if (s) s.lastResult = result;
      });
    }
    if (c.schedule?.useAssistant && !currentRun(opts.dir)) {
      try {
        if (opts.startAssistant) opts.startAssistant(c.id);
        else
          startRun({
            dir: opts.dir,
            campaignId: c.id,
            count: 5,
            mcpBundle: opts.mcpBundle,
            nodePath: opts.nodePath,
          });
      } catch {
        // No assistant installed or one already running; the board search still counts.
      }
    }
  }
  return ran;
}

/** Check once a minute. Returns a stop function. */
export function startScheduler(opts: SchedulerOptions): () => void {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runDueSearches(opts)
      .catch((e) => console.error(`Morning search: ${(e as Error).message}`))
      .finally(() => {
        busy = false;
      });
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
