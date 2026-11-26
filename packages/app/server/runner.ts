import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readState } from "./folderFile";

/**
 * One-click "Find jobs" (D-076): runs the user's own signed-in assistant
 * unattended, with the Career Desk connector limited to research tools for one
 * campaign. Nothing here can apply or send email.
 */

export type RunStep = {
  at: string;
  kind: "search" | "saved" | "tool" | "note" | "error";
  text: string;
};
export type Run = {
  id: string;
  campaignId: string;
  campaignName: string;
  assistant: string;
  target: number;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  jobsBefore: number;
  jobsAdded: number;
  steps: RunStep[];
  summary?: string;
  error?: string;
};
export type AssistantId = "codex" | "claude";
export type Assistant = { id: AssistantId; name: string; path: string };
const LABEL: Record<AssistantId, string> = { codex: "Codex", claude: "Claude Code" };

const MAX_MS = 15 * 60 * 1000;
const MAX_STEPS = 200;

// ---------- finding the assistant ----------

/** Codex updates itself into new folders, so look for the newest copy each time. */
export function findCodex(): string | undefined {
  const base = join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    "OpenAI",
    "Codex",
    "bin",
  );
  if (existsSync(base)) {
    const found = readdirSync(base)
      .map((d) => join(base, d, process.platform === "win32" ? "codex.exe" : "codex"))
      .filter((p) => existsSync(p))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (found[0]) return found[0];
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], {
    encoding: "utf8",
  });
  const line = which.status === 0 ? which.stdout.split(/\r?\n/).find(Boolean) : undefined;
  return line?.trim() || undefined;
}

/**
 * Claude Code signed in by the user: the native installer's copy, one on PATH,
 * or an npm install. The copy inside the Claude desktop app is not used: it
 * only works while the desktop app signs it in.
 */
export function findClaude(): string | undefined {
  const home = homedir();
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const local = join(home, ".local", "bin", exe);
  if (existsSync(local)) return local;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], {
    encoding: "utf8",
  });
  const lines =
    which.status === 0
      ? which.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  const direct = lines.find((l) => !/\.(cmd|bat|ps1)$/i.test(l) && !/Claude-Data/i.test(l));
  if (direct) return direct;
  // npm's claude.cmd can't be started without a shell; run its script with Node instead.
  const npm = join(
    process.env.APPDATA ?? join(home, "AppData", "Roaming"),
    "npm",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "cli.js",
  );
  return existsSync(npm) ? npm : undefined;
}

export function availableAssistants(): Assistant[] {
  const out: Assistant[] = [];
  const codex = findCodex();
  if (codex) out.push({ id: "codex", name: "Codex (your ChatGPT plan)", path: codex });
  const claude = findClaude();
  if (claude) out.push({ id: "claude", name: "Claude Code (your Claude plan)", path: claude });
  return out;
}

// ---------- what the assistant is asked to do ----------

type CampaignLike = {
  id: string;
  name: string;
  titles: string;
  locations: string;
  keywords: string;
  exclusions: string;
  minLpa: string;
  notes: string;
};

export function searchPrompt(c: CampaignLike, count: number) {
  const line = (label: string, v: string) => (v.trim() ? `- ${label}: ${v.trim()}\n` : "");
  return `You are running an unattended, research-only job search for Career Desk.
Use only the career-desk tools and web search. Do not ask questions; nobody is watching.

Campaign "${c.name}" (campaignId ${c.id}):
${line("Target roles", c.titles)}${line("Locations", c.locations)}${line("Keywords / target companies", c.keywords)}${line("Exclude", c.exclusions)}${line("Minimum annual CTC (LPA)", c.minLpa)}${line("Notes", c.notes.slice(0, 1500))}
Steps:
1. Call get_overview and list_jobs (campaignId ${c.id}) to read the profile and the jobs already saved.
2. Call search_job_boards (campaignId ${c.id}) once for ranked leads from LinkedIn, Indeed and Naukri; its scores come from the candidate's skills. Then use web search to find up to ${count} NEW, currently open roles that fit, starting with the best-scoring leads. Prefer the employer's own careers page or ATS (Workday, Greenhouse, Lever, the company site) over job boards and aggregators.
3. Open each listing before saving it. Skip anything closed, expired, unreachable, or already saved (in any campaign).
4. Save each with add_job (campaignId ${c.id}): the listing's own URL, company, title, location, a short description in your own words, salaryLpa only if published, minExperience and requiredCredentials if stated, and notes with why it fits and what the candidate should check (experience, degree, location, gaps). Set verified true only for listings you opened.
5. Never invent facts about the candidate or the job. Leave unknown fields blank.
6. Finish with save_session (campaignId ${c.id}): what you searched, what you saved or skipped and why, and a clear nextAction.
Stop after ${count} saved jobs or when you run out of good leads. Do not draft applications or emails.`;
}

// ---------- turning Codex events into readable steps ----------

type CodexEvent = {
  type?: string;
  item?: {
    type?: string;
    tool?: string;
    status?: string;
    text?: string;
    query?: string;
    action?: { type?: string; query?: string; queries?: string[]; url?: string };
    error?: { message?: string } | string | null;
    arguments?: unknown;
    result?: { isError?: boolean; is_error?: boolean; content?: { text?: string }[] } | null;
  };
  error?: { message?: string } | string;
  message?: string;
};

export function stepFromEvent(e: CodexEvent): Omit<RunStep, "at"> | undefined {
  const item = e.item ?? {};
  if (e.type === "item.completed" && item.type === "web_search") {
    if (item.action?.type === "open_page" && item.action.url)
      return { kind: "search", text: `Opened: ${item.action.url}` };
    const q = item.query || item.action?.query || item.action?.queries?.[0] || item.action?.url;
    return q ? { kind: "search", text: `Searched: ${q}` } : undefined;
  }
  if (e.type === "item.completed" && item.type === "mcp_tool_call") {
    if (item.status === "failed" || item.error)
      return { kind: "error", text: `${item.tool} failed: ${errText(item.error)}` };
    // Career Desk refusals (duplicate URL, wrong campaign...) come back as error results.
    if (item.result?.isError || item.result?.is_error)
      return {
        kind: "error",
        text: `${item.tool}: ${(item.result.content?.[0]?.text ?? "refused").slice(0, 300)}`,
      };
    if (item.tool === "add_job") {
      const a = (item.arguments ?? {}) as { company?: string; title?: string };
      return {
        kind: "saved",
        text: a.company ? `Saved: ${a.title ?? "a job"} at ${a.company}` : "Saved a job",
      };
    }
    if (item.tool === "save_session") return { kind: "note", text: "Saved the work session" };
    return undefined; // reads are not interesting to show
  }
  if (e.type === "item.completed" && item.type === "agent_message" && item.text)
    return { kind: "note", text: item.text.slice(0, 600) };
  if (e.type === "turn.failed" || e.type === "error")
    return {
      kind: "error",
      text: errText(e.error ?? e.message) || "The assistant stopped with an error",
    };
  return undefined;
}

// ---------- turning Claude Code stream-json events into readable steps ----------

type ClaudeBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};
type ClaudeEvent = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: ClaudeBlock[] | string };
};

/** Claude Code reports a tool call and its result separately; this pairs them. */
export function claudeStepper() {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const tool = (name: string) => name.replace(/^mcp__career-desk__/, "");
  return (e: ClaudeEvent): Omit<RunStep, "at">[] => {
    const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
    const out: Omit<RunStep, "at">[] = [];
    if (e.type === "assistant")
      for (const b of blocks) {
        if (b.type === "tool_use" && b.id && b.name) {
          calls.set(b.id, { name: b.name, input: b.input ?? {} });
          if (b.name === "WebSearch" && typeof b.input?.query === "string")
            out.push({ kind: "search", text: `Searched: ${b.input.query}` });
          if (b.name === "WebFetch" && typeof b.input?.url === "string")
            out.push({ kind: "search", text: `Opened: ${b.input.url}` });
        }
      }
    if (e.type === "user")
      for (const b of blocks) {
        if (b.type !== "tool_result" || !b.tool_use_id) continue;
        const call = calls.get(b.tool_use_id);
        if (!call?.name.startsWith("mcp__career-desk__")) continue;
        if (b.is_error) {
          const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          out.push({ kind: "error", text: `${tool(call.name)}: ${text.slice(0, 300)}` });
        } else if (tool(call.name) === "add_job") {
          const a = call.input as { company?: string; title?: string };
          out.push({
            kind: "saved",
            text: a.company ? `Saved: ${a.title ?? "a job"} at ${a.company}` : "Saved a job",
          });
        } else if (tool(call.name) === "save_session")
          out.push({ kind: "note", text: "Saved the work session" });
      }
    if (e.type === "result") {
      if (e.is_error || e.subtype !== "success")
        out.push({
          kind: "error",
          text: (e.result || "The assistant stopped with an error").slice(0, 600),
        });
      else if (e.result) out.push({ kind: "note", text: e.result.slice(0, 600) });
    }
    return out;
  };
}

function errText(e: unknown) {
  if (!e) return "";
  if (typeof e === "string") return e;
  return (e as { message?: string }).message ?? JSON.stringify(e).slice(0, 300);
}

// ---------- running ----------

const current = new Map<string, { run: Run; child: ChildProcess; stop: () => void }>();

function campaignJobs(dir: string, campaignId: string) {
  const state = readState(dir);
  if (!("exists" in state) || !state.exists) return 0;
  const w = state.value as { jobs?: { campaignId: string }[] };
  return (w.jobs ?? []).filter((j) => j.campaignId === campaignId).length;
}

function save(dir: string, run: Run) {
  const folder = join(dir, "runs");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

export function currentRun(dir: string) {
  const live = current.get(dir)?.run;
  if (live) live.jobsAdded = campaignJobs(dir, live.campaignId) - live.jobsBefore;
  return live;
}

export function recentRuns(dir: string, limit = 5): Run[] {
  const folder = join(dir, "runs");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".events.json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(folder, f), "utf8")) as Run;
      } catch {
        return undefined;
      }
    })
    .filter((r): r is Run => typeof r?.startedAt === "string" && Array.isArray(r.steps))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function startRun(opts: {
  dir: string;
  campaignId: string;
  count: number;
  mcpBundle: string;
  nodePath?: string;
  codexPath?: string;
  /** Which assistant runs the search; defaults to the first one installed. */
  assistant?: AssistantId;
  /** Tests only: run this program instead of the assistant (args are appended). */
  command?: { cmd: string; args: string[] };
  maxMs?: number;
}): Run {
  const { dir, campaignId } = opts;
  if (current.has(dir)) throw new Error("A job search is already running");
  const state = readState(dir);
  if (!("exists" in state) || !state.exists) throw new Error("No workspace yet");
  const w = state.value as { campaigns?: CampaignLike[] };
  const campaign = (w.campaigns ?? []).find((c) => c.id === campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const installed = opts.command ? [] : availableAssistants();
  const kind: AssistantId =
    opts.assistant ?? (opts.codexPath ? "codex" : (installed[0]?.id ?? "codex"));
  const label = LABEL[kind];
  const program =
    opts.command?.cmd ??
    (kind === "codex" ? opts.codexPath : undefined) ??
    installed.find((a) => a.id === kind)?.path;
  if (!program)
    throw new Error(
      kind === "claude"
        ? "Claude Code isn't installed on this PC (the copy inside the Claude app can't run on its own)"
        : "Codex isn't installed on this PC",
    );
  if (!existsSync(opts.mcpBundle)) throw new Error("The assistant connector hasn't been built yet");
  const count = Math.min(10, Math.max(1, Math.round(opts.count) || 5));

  const lit = (s: string) => {
    if (s.includes("'")) throw new Error(`Path can't contain a quote: ${s}`);
    return `'${s}'`;
  };
  const node = opts.nodePath ?? process.execPath;
  const connectorArgs = [opts.mcpBundle, "--dir", dir, "--research-only", "--campaign", campaignId];
  const codexArgs = () => [
    "--search",
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-c",
    `mcp_servers.career-desk.command=${lit(node)}`,
    "-c",
    `mcp_servers.career-desk.args=[${connectorArgs.map(lit).join(", ")}]`,
    "-",
  ];
  // Claude Code: only the research-limited connector and web search/fetch are allowed.
  const claudeArgs = (mcpConfig: string) => [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--allowedTools",
    "mcp__career-desk,WebSearch,WebFetch",
    "--disallowedTools",
    "Bash,Edit,Write,NotebookEdit,Task",
  ];
  const run: Run = {
    id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${campaignId.slice(0, 8)}`,
    campaignId,
    campaignName: campaign.name,
    assistant: label,
    target: count,
    status: "running",
    startedAt: new Date().toISOString(),
    jobsBefore: campaignJobs(dir, campaignId),
    jobsAdded: 0,
    steps: [
      {
        at: new Date().toISOString(),
        kind: "note",
        text: `Starting ${label} to find up to ${count} jobs`,
      },
    ],
  };
  mkdirSync(join(dir, "runs"), { recursive: true });
  let args: string[];
  if (kind === "claude") {
    mkdirSync(join(dir, "runs", "config"), { recursive: true });
    const mcpConfig = join(dir, "runs", "config", `${run.id}.mcp.json`);
    writeFileSync(
      mcpConfig,
      JSON.stringify({ mcpServers: { "career-desk": { command: node, args: connectorArgs } } }),
    );
    args = claudeArgs(mcpConfig);
  } else args = codexArgs();
  // npm installs of Claude Code are a script run with Node.
  const viaNode = !opts.command && program.endsWith(".js");
  const cmd = viaNode ? node : program;
  const fullArgs = opts.command
    ? [...opts.command.args, ...args]
    : viaNode
      ? [program, ...args]
      : args;
  const claudeStep = claudeStepper();
  const toSteps = (e: unknown): Omit<RunStep, "at">[] => {
    if (kind === "claude") return claudeStep(e as ClaudeEvent);
    const step = stepFromEvent(e as CodexEvent);
    return step ? [step] : [];
  };
  let lastResult = "";
  const child = spawn(cmd, fullArgs, {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const add = (s: Omit<RunStep, "at">) => {
    run.steps.push({ at: new Date().toISOString(), ...s });
    if (run.steps.length > MAX_STEPS) run.steps.splice(1, run.steps.length - MAX_STEPS);
    save(dir, run);
  };
  let stderr = "";
  let rawBytes = 0;
  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    for (let k = buf.indexOf("\n"); k >= 0; k = buf.indexOf("\n")) {
      const line = buf.slice(0, k).trim();
      buf = buf.slice(k + 1);
      if (!line) continue;
      // Raw events, kept for diagnosing a run (capped at ~2 MB).
      if (rawBytes < 2_000_000) {
        rawBytes += line.length;
        appendFileSync(
          join(dir, "runs", `${run.id}.events.jsonl`),
          `${line}
`,
        );
      }
      try {
        const event = JSON.parse(line);
        if (event?.type === "result" && typeof event.result === "string") lastResult = event.result;
        for (const step of toSteps(event)) add(step);
      } catch {
        /* not an event line */
      }
    }
  });
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString("utf8")).slice(-4000);
  });
  let stopped = false;
  const timer = setTimeout(() => {
    add({ kind: "error", text: "Stopped after 15 minutes" });
    kill(child);
  }, opts.maxMs ?? MAX_MS);
  const finish = (status: Run["status"], error?: string) => {
    clearTimeout(timer);
    if (!current.has(dir)) return;
    current.delete(dir);
    run.status = status;
    run.endedAt = new Date().toISOString();
    run.jobsAdded = campaignJobs(dir, campaignId) - run.jobsBefore;
    if (error) run.error = error;
    run.summary =
      status === "stopped"
        ? `Stopped. ${run.jobsAdded} job${run.jobsAdded === 1 ? "" : "s"} saved before stopping.`
        : status === "done"
          ? `Saved ${run.jobsAdded} new job${run.jobsAdded === 1 ? "" : "s"}.`
          : `The search failed: ${error ?? "unknown error"}`;
    save(dir, run);
  };
  child.on("error", (e) => finish("failed", `Couldn't start ${label}: ${e.message}`));
  child.on("close", (code) => {
    if (stopped) return finish("stopped");
    if (code === 0) return finish("done");
    const said = `${stderr}\n${lastResult}`;
    const hint = /log(?:ged)? ?in|sign(?:ed)? ?in|auth|\/login/i.test(said)
      ? kind === "claude"
        ? " Open a terminal, run claude and sign in, then try again."
        : " Open Codex and sign in, then try again."
      : "";
    finish(
      "failed",
      `${label} exited with code ${code}.${hint} ${lastLine(stderr) || lastResult.slice(0, 300)}`.trim(),
    );
  });
  child.stdin?.end(searchPrompt(campaign, count));
  current.set(dir, {
    run,
    child,
    stop: () => {
      stopped = true;
      kill(child);
    },
  });
  save(dir, run);
  return run;
}

export function stopRun(dir: string) {
  const live = current.get(dir);
  if (!live) throw new Error("No job search is running");
  live.stop();
}

function kill(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

function lastLine(s: string) {
  return s.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300) ?? "";
}
