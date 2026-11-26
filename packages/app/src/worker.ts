/// <reference lib="webworker" />
import type { AnalysisContext, Finding, ResumeDoc } from "@tailorats/core";
import type { ModelProgressInfo, ProviderConfig } from "@tailorats/llm";
import { analyze } from "@tailorats/pipeline";
import { getPacks } from "@tailorats/rules/bundled";
// Vite resolves this to a bundled worker chunk; core stays bundler-agnostic (D-033).
import PdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker";

/**
 * The real analysis pipeline, running in a Web Worker (D-011/D-031).
 * Packs are inlined JSON, pdf.js parses the bytes in-page.
 *
 * `kind: "resumedoc"` (O-16) re-enters analyze() with a doc already
 * extracted by an earlier `pdf`/`tex` call in this same worker file — the
 * app's async on-device review pass uses this to re-run just the LLM review
 * step, no re-parse. `llm` defaults to on-device inference (D-049) when the
 * caller (analyzeClient.ts) sets it — the one network activity this app has,
 * a one-time model fetch cached by the browser, never resume content.
 */

export interface WorkerRequest {
  kind: "pdf" | "tex" | "resumedoc";
  bytes?: ArrayBuffer;
  source?: string;
  doc?: ResumeDoc;
  fidelity?: { score: number; findings: Finding[] };
  packIds: string[];
  context: AnalysisContext;
  llm?: ProviderConfig;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { kind, bytes, source, doc, fidelity, packIds, context, llm } = event.data;
  try {
    const packs = getPacks(packIds);
    const source_ =
      kind === "pdf"
        ? ({ kind: "pdf", data: new Uint8Array(bytes as ArrayBuffer) } as const)
        : kind === "tex"
          ? ({ kind: "tex", source: source as string } as const)
          : ({
              kind: "resumedoc",
              doc: doc as ResumeDoc,
              ...(fidelity ? { fidelity } : {}),
            } as const);
    // Progress can only be wired up here: functions can't cross postMessage,
    // so `llm.onProgress` never survives the trip from the main thread — it
    // has to be built worker-side and posted back out as its own message
    // (D-056/O-19).
    const llmWithProgress = llm
      ? {
          ...llm,
          onProgress: (info: ModelProgressInfo) =>
            self.postMessage({ type: "progress", progress: info }),
        }
      : undefined;
    const {
      report,
      doc: resultDoc,
      notes,
    } = await analyze({
      source: source_,
      context,
      packs,
      ...(llmWithProgress ? { llm: { config: llmWithProgress } } : {}),
      ...(kind === "pdf" ? { pdfWorker: { workerPort: new PdfjsWorker() } } : {}),
    });
    self.postMessage({ ok: true, report, doc: resultDoc, notes });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
