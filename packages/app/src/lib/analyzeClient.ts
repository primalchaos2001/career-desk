import type {
  AnalysisContext,
  Finding as CoreFinding,
  Report as CoreReport,
  ResumeDoc,
} from "@tailorats/core";
import type { ModelProgressInfo, ProviderConfig } from "@tailorats/llm";
import type { AnalyzeInput, Region, Report, Role } from "./report";
import { getReport, getReviewInput, saveReport, saveReviewInput } from "./reportStore";

/**
 * The seam (D-026): the Lovable prototype called a synchronous mockAnalyze().
 * Here we run the *real* @tailorats/pipeline analyze() inside the Web Worker
 * (src/worker.ts) so heavy PDF parsing never blocks the UI thread, and wrap the
 * core Report (which has no id/filename/createdAt — those are an app concern)
 * into the stored app Report.
 *
 * O-19 (D-056): AI review is opt-in, not automatic — analyzeResume() only
 * runs the fast deterministic pass and persists what a later review pass
 * would need (see saveReviewInput). generateAiReview() is a separate,
 * explicitly-called function the report page's "Generate AI review" button
 * awaits directly; there is no background pass or pending-state registry
 * anymore (D-054's fire-and-forget default is superseded — see D-056 for why:
 * a flat timeout firing mid-download with no visible reason was a real bug
 * users hit).
 */

const REGION_PACK: Record<Region, string> = {
  us: "region/us",
  india: "region/india",
  uk: "region/uk",
  de: "region/de",
};

// Only these industries have a dedicated pack; the rest add no rules.
const INDUSTRY_PACK: Record<string, string | undefined> = {
  finance: "industry/finance",
  consulting: "industry/consulting",
};

// Stages with a loadable stage/<x> pack. A stage with no pack of its own
// (new-grad, early-career) adds no stage-level rules of its own.
const STAGE_PACK: Record<string, string | undefined> = {
  student: "stage/student",
};

function packIdsFor(input: AnalyzeInput): string[] {
  const ids: string[] = [];
  const stagePack = STAGE_PACK[input.stage];
  if (stagePack) ids.push(stagePack);
  if (input.industry) {
    const pack = INDUSTRY_PACK[input.industry];
    if (pack) ids.push(pack);
  }
  // Role values match packages/rules/rulepacks/role/<x>.yaml exactly (report.ts).
  ids.push(`role/${input.role}`, REGION_PACK[input.region]);
  return ids;
}

type WorkerResponse =
  | { ok: true; report: CoreReport; doc: ResumeDoc; notes: string[] }
  | { ok: false; error: string };

type WorkerMessage = WorkerResponse | { type: "progress"; progress: ModelProgressInfo };

function runWorker(
  message: unknown,
  transfer: Transferable[],
  opts?: { stallTimeoutMs?: number; onProgress?: (info: ModelProgressInfo) => void },
): Promise<WorkerResponse> {
  const worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module" });
  const stallTimeoutMs = opts?.stallTimeoutMs;
  return new Promise<WorkerResponse>((resolve, reject) => {
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    // Resets on every progress event (D-056/O-19) — a slow-but-moving
    // download must never be killed. Fires only on genuine silence, which is
    // the real failure mode this replaces a flat wall-clock cap for (a stuck
    // CDN fetch that never rejects its own promise, reproduced live in D-054).
    const resetStall = () => {
      if (!stallTimeoutMs) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        worker.terminate();
        reject(
          new Error(
            `AI review stalled — no progress for ${Math.round(stallTimeoutMs / 1000)}s. Check your connection and retry.`,
          ),
        );
      }, stallTimeoutMs);
    };
    resetStall();
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if ("type" in event.data && event.data.type === "progress") {
        resetStall();
        opts?.onProgress?.(event.data.progress);
        return;
      }
      if (stallTimer) clearTimeout(stallTimer);
      resolve(event.data as WorkerResponse);
      worker.terminate();
    };
    worker.onerror = (event) => {
      if (stallTimer) clearTimeout(stallTimer);
      reject(new Error(event.message || "Analysis worker crashed"));
      worker.terminate();
    };
    worker.postMessage(message, transfer);
  });
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface ReportMeta {
  filename: string;
  createdAt: string;
  contextUsed: Report["contextUsed"];
}

/** Wraps a core Report into the stored app shape — shared by both passes. */
function toAppReport(core: CoreReport, id: string, meta: ReportMeta): Report {
  return {
    id,
    filename: meta.filename,
    createdAt: meta.createdAt,
    ...(core.overall !== undefined ? { overall: core.overall } : {}),
    ...(core.sections ? { sections: core.sections } : {}),
    ...(core.readouts ? { readouts: core.readouts } : {}),
    scores: core.scores,
    findings: core.findings,
    contextUsed: meta.contextUsed,
  };
}

/** The fidelity score/findings pass 1 computed, for the review pass to carry through unchanged. */
function fidelityOf(core: CoreReport): { score: number; findings: CoreFinding[] } | undefined {
  return core.scores.fidelity !== undefined
    ? { score: core.scores.fidelity, findings: core.findings.filter((f) => f.layer === "fidelity") }
    : undefined;
}

/**
 * e2e-only escape hatch (D-056/O-19): swap the real ~600MB Qwen3-0.6B model for a
 * tiny test model. No UI ever sets this — see e2e/ui.spec.ts.
 */
function localModelOverride(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem("cv-guide.e2e.localModel") ?? undefined;
}

// Resets on progress, so this is "how long we tolerate silence", not a cap
// on the whole download — see runWorker's comment.
const STALL_TIMEOUT_MS = 300_000;

/**
 * B-6: onnxruntime-web silently falls back to WASM/CPU when no WebGPU
 * adapter is available ("removing requested execution provider webgpu...",
 * reproduced live) — several minutes slower, with zero indication to the
 * user why. Brave in particular disables WebGPU by default in many
 * versions (privacy/fingerprinting), so this is a real, common case, not a
 * rare edge one. `"gpu" in navigator` alone isn't enough — the property can
 * exist while `requestAdapter()` still resolves null, exactly what was
 * observed — so this actually asks for an adapter.
 */
export async function checkGpuAvailable(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export interface AnalyzeRequest {
  file: File;
  region: Region;
  role: Role;
  industry?: AnalyzeInput["industry"];
  stage: AnalyzeInput["stage"];
  jobDescription?: string;
}

/** Extract facts for a profile without inventing a target role or storing a review. */
export async function extractCandidateResume(file: File): Promise<ResumeDoc> {
  const kind = file.name.toLowerCase().endsWith(".tex") ? "tex" : "pdf";
  if (!/\.(pdf|tex)$/i.test(file.name)) throw new Error("Choose a PDF or .tex CV");
  const context = { region: "india", role: "general", stage: "early-career" };
  let response: WorkerResponse;
  if (kind === "tex") {
    response = await runWorker({ kind, source: await file.text(), packIds: [], context }, [], {
      stallTimeoutMs: 60_000,
    });
  } else {
    const bytes = await file.arrayBuffer();
    response = await runWorker({ kind, bytes, packIds: [], context }, [bytes], {
      stallTimeoutMs: 60_000,
    });
  }
  if (!response.ok) throw new Error(response.error);
  return response.doc;
}

/**
 * Runs the fast deterministic pipeline in the worker and returns a
 * stored-app-shaped Report. Also persists what a later `generateAiReview()`
 * call needs (D-056/O-19) — the doc, fidelity, packs, and context — so the
 * "Generate AI review" button works on this report even after a reload.
 */
export async function analyzeResume(req: AnalyzeRequest): Promise<Report> {
  const name = req.file.name.toLowerCase();
  const kind: "pdf" | "tex" = name.endsWith(".tex") ? "tex" : "pdf";
  if (kind === "pdf" && !name.endsWith(".pdf")) {
    throw new Error("Upload a PDF or a .tex file — DOCX and plain-text support is coming.");
  }

  const input: AnalyzeInput = {
    filename: req.file.name,
    resumeText: "",
    region: req.region,
    role: req.role,
    ...(req.industry ? { industry: req.industry } : {}),
    stage: req.stage,
    ...(req.jobDescription ? { jobDescription: req.jobDescription } : {}),
  };
  const packIds = packIdsFor(input);
  const context: AnalysisContext = {
    region: req.region,
    role: req.role,
    ...(req.industry ? { industry: req.industry } : {}),
    stage: req.stage,
    ...(req.jobDescription ? { jobDescription: req.jobDescription } : {}),
  };

  // Deterministic only, no llm: fidelity + rule packs + impact/findability
  // scoring. This is the whole product for a user who never clicks the AI
  // button — it must stay fast regardless of anything below.
  let response: WorkerResponse;
  if (kind === "tex") {
    response = await runWorker({ kind, source: await req.file.text(), packIds, context }, []);
  } else {
    const bytes = await req.file.arrayBuffer();
    response = await runWorker({ kind, bytes, packIds, context }, [bytes]);
  }

  if (!response.ok) throw new Error(response.error);

  const id = newId();
  const meta: ReportMeta = {
    filename: req.file.name,
    createdAt: new Date().toISOString(),
    contextUsed: {
      region: req.region,
      role: req.role,
      ...(req.industry ? { industry: req.industry } : {}),
      stage: req.stage,
      jobDescriptionProvided: !!(req.jobDescription && req.jobDescription.trim().length > 0),
    },
  };
  const report = toAppReport(response.report, id, meta);

  await saveReviewInput({
    reportId: id,
    doc: response.doc,
    ...(fidelityOf(response.report) ? { fidelity: fidelityOf(response.report) } : {}),
    packIds,
    context,
  });

  return report;
}

/**
 * D-061: the "Generate AI review" button is on-device by definition — its
 * own UI copy promises "entirely in your browser... nothing leaves your
 * device" (analyze.$reportId.tsx). A brief regression (same day, unshipped)
 * made a Settings API key silently swap this button to a hosted provider
 * instead — a broken promise, not a feature, and found live as the actual
 * cause of "AI review won't complete": a stray/misconfigured Settings key
 * was silently redirecting every click to a hosted call. This button must
 * always request on-device inference; a genuinely separate "review with
 * your own API key" action, if wanted, needs its own explicit UI surface,
 * not a silent substitution here (see CHATGPT_OPTMIZATIONS.md's "Provider
 * behavior to implement" table for the shape that would take).
 */
function getProviderConfig(): ProviderConfig {
  return {
    includeLocal: true,
    ...(localModelOverride() ? { localModel: localModelOverride() } : {}),
  };
}

/**
 * Runs the on-device AI review pass for an already-analyzed report (D-056/
 * O-19) — the "Generate AI review" button's action. Re-enters analyze() with
 * the doc saved by analyzeResume() (no re-parse), merges the result, and
 * persists it. Throws (with a real, user-facing reason) rather than failing
 * silently — the caller decides how to show that.
 */
export async function generateAiReview(
  reportId: string,
  onProgress?: (info: ModelProgressInfo) => void,
): Promise<Report> {
  const [input, fastReport] = await Promise.all([getReviewInput(reportId), getReport(reportId)]);
  if (!input) {
    throw new Error("This report has no saved data to review — try analyzing the résumé again.");
  }
  if (!fastReport) throw new Error("Report not found.");

  const llm = getProviderConfig();
  const meta: ReportMeta = {
    filename: fastReport.filename,
    createdAt: fastReport.createdAt,
    contextUsed: fastReport.contextUsed,
  };

  const response = await runWorker(
    {
      kind: "resumedoc",
      doc: input.doc,
      ...(input.fidelity ? { fidelity: input.fidelity } : {}),
      packIds: input.packIds,
      context: input.context,
      llm,
    },
    [],
    { stallTimeoutMs: STALL_TIMEOUT_MS, ...(onProgress ? { onProgress } : {}) },
  );
  if (!response.ok) throw new Error(response.error);

  // A review that fails INSIDE analyze() (e.g. the model never returned
  // valid JSON) degrades gracefully there (D-052) instead of throwing —
  // `notes` is where that reason ends up. Surface it as a real error here
  // too, rather than silently returning a report with no new findings.
  const failedNote = response.notes.find((n) => n.startsWith("AI review failed"));
  if (failedNote) throw new Error(failedNote);

  const updated = toAppReport(response.report, reportId, meta);
  await saveReport(updated);
  return updated;
}
