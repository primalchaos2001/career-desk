import type { ModelProgressInfo } from "@tailorats/llm";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionReadoutCard } from "@/components/SectionReadoutCard";
import { checkGpuAvailable, generateAiReview } from "@/lib/analyzeClient";
import { buildFeedbackIssueUrl, buildMissIssueUrl } from "@/lib/issueLinks";
import type { Finding, Report } from "@/lib/report";
import {
  INDUSTRY_LABELS,
  REGION_LABELS,
  ROLE_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
  STAGE_LABELS,
} from "@/lib/report";
import {
  deleteReport,
  getPersistedState,
  getReport,
  getReviewInput,
  type PersistedFindingState,
  setApplied,
  setReason,
  setVerdict,
} from "@/lib/reportStore";

export const Route = createFileRoute("/analyze/$reportId")({
  component: AnalyzePage,
});

function AnalyzePage() {
  const { reportId } = Route.useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<Record<string, PersistedFindingState>>({});
  const [loading, setLoading] = useState(true);
  // O-19: AI review is opt-in (D-056) — whether the "Generate AI review"
  // button can even run depends on whether analyzeResume() saved the review
  // input for this report (older reports, pre-O-19, won't have one).
  const [reviewAvailable, setReviewAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [r, s, ri] = await Promise.all([
        getReport(reportId),
        getPersistedState(reportId),
        getReviewInput(reportId),
      ]);
      if (cancelled) return;
      setReport(r ?? null);
      setState(s);
      setReviewAvailable(!!ri);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const findings = useMemo(() => {
    if (!report) return [];
    return report.findings.map((f) => ({
      ...f,
      verdict: state[f.id]?.verdict ?? null,
      reason: state[f.id]?.reason,
      applied: state[f.id]?.applied ?? false,
    }));
  }, [report, state]);

  const pendingVerdicts = useMemo(
    () =>
      findings
        .filter((f): f is typeof f & { verdict: "up" | "down" | "na" } => f.verdict != null)
        .map((f) => ({ id: f.id, verdict: f.verdict, reason: f.reason })),
    [findings],
  );

  async function toggleApplied(id: string) {
    const next = !(state[id]?.applied ?? false);
    setState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { verdict: null, applied: false }), applied: next },
    }));
    await setApplied(reportId, id, next);
  }
  async function vote(id: string, v: "up" | "down" | "na") {
    const current = state[id]?.verdict ?? null;
    const next = current === v ? null : v;
    setState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { verdict: null, applied: false }), verdict: next },
    }));
    await setVerdict(reportId, id, next);
  }
  async function saveReason(id: string, reason: string) {
    setState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { verdict: null, applied: false }), reason },
    }));
    await setReason(reportId, id, reason);
  }

  async function onDelete() {
    if (!confirm("Delete this report from this browser?")) return;
    await deleteReport(reportId);
    toast.success("Report deleted");
    navigate({ to: "/history" });
  }

  if (loading) {
    return <div className="container-page py-16 text-muted-foreground">Loading report…</div>;
  }
  if (!report) {
    return (
      <div className="container-page py-16">
        <h1 className="font-serif text-3xl">Report not found</h1>
        <p className="mt-2 text-muted-foreground">
          Reports live only in this browser. If you cleared storage or switched browsers, it’s gone.
        </p>
        <Link to="/" className="mt-6 inline-block text-primary underline underline-offset-4">
          Analyze a new résumé
        </Link>
      </div>
    );
  }

  const { contextUsed, sections, overall, readouts } = report;
  const readoutFor = (section: (typeof SECTION_ORDER)[number]) =>
    readouts?.find((r) => r.section === section);
  const presentSections = SECTION_ORDER.filter(
    (s) => sections?.[s] !== undefined || findings.some((f) => f.section === s),
  );

  return (
    <div className="container-page py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Report</p>
          <h1 className="mt-1 font-serif text-3xl">{report.filename}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {REGION_LABELS[contextUsed.region]} · {ROLE_LABELS[contextUsed.role]}
            {contextUsed.industry ? ` · ${INDUSTRY_LABELS[contextUsed.industry]}` : ""} ·{" "}
            {STAGE_LABELS[contextUsed.stage]}
            {contextUsed.jobDescriptionProvided ? " · JD attached" : " · no JD"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={buildMissIssueUrl(contextUsed)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Report a miss
          </a>
          {pendingVerdicts.length > 0 && (
            <a
              href={buildFeedbackIssueUrl(contextUsed, pendingVerdicts)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Share feedback ({pendingVerdicts.length})
            </a>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[18rem_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start space-y-4">
          <OverallCard score={overall} />
          {reviewAvailable && !findings.some((f) => f.enriched) && (
            <AiReviewPanel reportId={reportId} onSettled={setReport} />
          )}
          {presentSections.map((s) => (
            <SectionRow key={s} label={SECTION_LABELS[s]} score={sections?.[s]} />
          ))}
          <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground">
            Scores prioritize fixes — they’re not a fake “ATS pass rate”. Weighted for your role and
            stage.
          </div>
        </aside>

        <section className="space-y-6">
          {presentSections.map((section) => {
            const items = findings.filter((f) => f.section === section);
            const readout = readoutFor(section);
            if (items.length === 0 && !readout) return null;
            return (
              <div key={section}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-serif text-xl">{SECTION_LABELS[section]}</h2>
                  {sections?.[section] !== undefined && (
                    <span className={`text-sm font-mono ${scoreColor(sections[section])}`}>
                      {sections[section]}
                    </span>
                  )}
                </div>
                {readout && (
                  <div className="mt-3">
                    <SectionReadoutCard readout={readout} />
                  </div>
                )}
                <ul className="mt-3 space-y-3">
                  {items.map((f) => (
                    <FindingCard
                      key={f.id}
                      f={f}
                      onToggleApplied={() => toggleApplied(f.id)}
                      onVote={(v) => vote(f.id, v)}
                      onReasonBlur={(reason) => saveReason(f.id, reason)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
          {findings.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
              No issues found for this context. Nicely done.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function scoreColor(score?: number): string {
  if (typeof score !== "number") return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function OverallCard({ score }: { score?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall</p>
      <p className={`mt-1 font-serif text-6xl ${scoreColor(score)}`}>
        {typeof score === "number" ? score : "—"}
        <span className="text-2xl text-muted-foreground">/100</span>
      </p>
    </div>
  );
}

type AiReviewState =
  | { phase: "idle" }
  | { phase: "downloading"; file?: string; percent?: number }
  | { phase: "reviewing" }
  | { phase: "error"; message: string };

/**
 * The "Generate AI review" button (D-056/O-19). Opt-in, not automatic — the
 * deterministic report above is already the full product; this is an
 * enrichment a user explicitly asks for. Shows real download progress and
 * never fails silently: an error here always leaves a visible reason + Retry.
 */
function AiReviewPanel({
  reportId,
  onSettled,
}: {
  reportId: string;
  onSettled: (r: Report) => void;
}) {
  const [state, setState] = useState<AiReviewState>({ phase: "idle" });
  // B-6: checked once up front so the "this may be slow" hint is visible
  // before the user commits to clicking, not discovered minutes into a
  // silent WASM fallback. null = still checking.
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkGpuAvailable().then((available) => {
      if (!cancelled) setGpuAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setState({ phase: "downloading" });
    try {
      const updated = await generateAiReview(reportId, (info: ModelProgressInfo) => {
        if (info.status === "generating") {
          setState({ phase: "reviewing" });
        } else if (info.status === "progress") {
          setState({
            phase: "downloading",
            ...(info.file ? { file: info.file } : {}),
            ...(info.progress !== undefined ? { percent: Math.round(info.progress) } : {}),
          });
        }
      });
      // A resolved promise doesn't guarantee new findings landed (the model
      // can produce something the pipeline accepts but that adds nothing
      // useful) — treat "nothing changed" as a visible outcome too, not a
      // silent reset back to the button (the exact bug this panel replaces).
      if (updated.findings.some((f) => f.enriched)) {
        setState({ phase: "idle" });
        onSettled(updated);
      } else {
        setState({
          phase: "error",
          message: "The AI review finished but didn't add anything new — you can try again.",
        });
      }
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "AI review failed" });
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-4 space-y-2">
      {state.phase === "idle" && (
        <>
          <button
            type="button"
            onClick={run}
            className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Generate AI review
          </button>
          <p className="text-xs text-muted-foreground">
            Runs a small AI model entirely in your browser for richer explanations and concrete
            rewrites. First run downloads ~600 MB (cached after) — nothing leaves your device.
          </p>
          {gpuAvailable === false && (
            <p className="text-xs text-amber-600">
              No GPU acceleration detected in this browser — the review will run on CPU and can take
              several minutes. Some browsers (Brave, in particular) disable WebGPU by default; check
              your browser's hardware-acceleration or GPU settings if you'd like to try enabling it.
            </p>
          )}
        </>
      )}
      {state.phase === "downloading" && (
        <p className="text-xs text-muted-foreground animate-pulse">
          Downloading AI model{state.file ? ` (${state.file})` : ""}
          {state.percent !== undefined ? ` — ${state.percent}%` : "…"} — meanwhile, take a look at
          the report below.
        </p>
      )}
      {state.phase === "reviewing" && (
        <p className="text-xs text-muted-foreground animate-pulse">Reviewing your résumé…</p>
      )}
      {state.phase === "error" && (
        <>
          <p className="text-xs text-destructive">AI review failed: {state.message}</p>
          <button
            type="button"
            onClick={run}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}

function SectionRow({ label, score }: { label: string; score?: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`font-serif text-2xl ${scoreColor(score)}`}>
        {typeof score === "number" ? score : "—"}
      </span>
    </div>
  );
}

function FindingCard({
  f,
  onToggleApplied,
  onVote,
  onReasonBlur,
}: {
  f: Finding;
  onToggleApplied: () => void;
  onVote: (v: "up" | "down" | "na") => void;
  onReasonBlur: (reason: string) => void;
}) {
  const [reason, setReasonInput] = useState(f.reason ?? "");
  const pri = f.priority;
  const pillColor =
    pri === "P0"
      ? "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30"
      : pri === "P1"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <li
      className={`rounded-lg border border-border bg-card p-5 transition ${f.applied ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-0.5 text-xs font-mono ${pillColor}`}>
              {pri}
            </span>
            <span className="text-xs text-muted-foreground">{f.source}</span>
            {f.enriched && (
              <span className="rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary">
                AI-enriched
              </span>
            )}
          </div>
          <h3 className={`mt-2 font-serif text-lg ${f.applied ? "line-through" : ""}`}>
            {f.title}
          </h3>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => onVote("up")}
            aria-label="Helpful"
            className={`rounded border px-2 py-1 ${f.verdict === "up" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onVote("down")}
            aria-label="Not helpful"
            className={`rounded border px-2 py-1 ${f.verdict === "down" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onVote("na")}
            aria-label="Not applicable to my region or role"
            className={`rounded border px-2 py-1 ${f.verdict === "na" ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
          >
            N/A
          </button>
        </div>
      </div>

      {f.verdict && (
        <input
          type="text"
          value={reason}
          onChange={(e) => setReasonInput(e.target.value)}
          onBlur={() => {
            if (reason !== (f.reason ?? "")) onReasonBlur(reason);
          }}
          placeholder="Optional: why? (included if you share feedback)"
          className="mt-3 w-full rounded border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/60"
        />
      )}

      <p className="mt-3 rounded bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
        {f.evidence}
      </p>
      <p className="mt-3 text-sm">{f.why}</p>

      {f.suggestion && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {f.suggestion.before && (
            <div className="rounded border border-border p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Before</p>
              <p className="mt-1 font-mono">{f.suggestion.before}</p>
            </div>
          )}
          {f.suggestion.after && (
            <div className="rounded border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-primary">After</p>
              <p className="mt-1 font-mono">{f.suggestion.after}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onToggleApplied}
          className={`rounded px-3 py-1.5 text-xs ${f.applied ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border border-border text-muted-foreground hover:text-foreground"}`}
        >
          {f.applied ? "Applied ✓" : "Mark as applied"}
        </button>
      </div>
    </li>
  );
}
