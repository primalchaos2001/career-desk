import type { AnalysisContext, Finding, ResumeDoc } from "@tailorats/core";
import { type IDBPDatabase, openDB } from "idb";
import type { Report } from "./report";

const DB_NAME = "cv-guide";
const DB_VERSION = 2;
const REPORTS = "reports";
const VERDICTS = "verdicts";
const REVIEW_INPUTS = "reviewInputs";

/**
 * What a fresh call to analyze() needs for the async on-device review pass
 * (D-056/O-19), saved right after the fast pass so the "Generate AI review"
 * button works even after a reload — no re-parsing the résumé. `context` is
 * the raw AnalysisContext (jobDescription included); Report.contextUsed only
 * keeps a boolean, not the text.
 */
export interface ReviewInputRow {
  reportId: string;
  doc: ResumeDoc;
  fidelity?: { score: number; findings: Finding[] };
  packIds: string[];
  context: AnalysisContext;
}

interface VerdictRow {
  key: string; // `${reportId}:${findingId}`
  reportId: string;
  findingId: string;
  verdict: "up" | "down" | "na" | null;
  reason?: string;
  applied: boolean;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only available in the browser.");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(REPORTS)) {
          d.createObjectStore(REPORTS, { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains(VERDICTS)) {
          const s = d.createObjectStore(VERDICTS, { keyPath: "key" });
          s.createIndex("reportId", "reportId", { unique: false });
        }
        if (!d.objectStoreNames.contains(REVIEW_INPUTS)) {
          d.createObjectStore(REVIEW_INPUTS, { keyPath: "reportId" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveReport(r: Report): Promise<void> {
  const d = await db();
  await d.put(REPORTS, r);
}

export async function getReport(id: string): Promise<Report | undefined> {
  const d = await db();
  return (await d.get(REPORTS, id)) as Report | undefined;
}

export async function listReports(): Promise<Report[]> {
  const d = await db();
  const all = (await d.getAll(REPORTS)) as Report[];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteReport(id: string): Promise<void> {
  const d = await db();
  await d.delete(REPORTS, id);
  await d.delete(REVIEW_INPUTS, id);
  const tx = d.transaction(VERDICTS, "readwrite");
  const idx = tx.store.index("reportId");
  for await (const cur of idx.iterate(id)) await cur.delete();
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear(REPORTS);
  await d.clear(VERDICTS);
  await d.clear(REVIEW_INPUTS);
}

/** Saved right after the fast pass (D-056/O-19) — see ReviewInputRow. */
export async function saveReviewInput(row: ReviewInputRow): Promise<void> {
  const d = await db();
  await d.put(REVIEW_INPUTS, row);
}

export async function getReviewInput(reportId: string): Promise<ReviewInputRow | undefined> {
  const d = await db();
  return (await d.get(REVIEW_INPUTS, reportId)) as ReviewInputRow | undefined;
}

async function upsertVerdictRow(
  reportId: string,
  findingId: string,
  patch: Partial<Pick<VerdictRow, "verdict" | "applied" | "reason">>,
): Promise<void> {
  const d = await db();
  const key = `${reportId}:${findingId}`;
  const tx = d.transaction(VERDICTS, "readwrite");
  const existing = ((await tx.store.get(key)) as VerdictRow | undefined) ?? {
    key,
    reportId,
    findingId,
    verdict: null,
    applied: false,
  };
  const next: VerdictRow = { ...existing, ...patch };
  await tx.store.put(next);
  await tx.done;
}

export async function setVerdict(
  reportId: string,
  findingId: string,
  verdict: "up" | "down" | "na" | null,
): Promise<void> {
  await upsertVerdictRow(reportId, findingId, { verdict });
}

export async function setReason(
  reportId: string,
  findingId: string,
  reason: string,
): Promise<void> {
  await upsertVerdictRow(reportId, findingId, { reason });
}

export async function setApplied(
  reportId: string,
  findingId: string,
  applied: boolean,
): Promise<void> {
  await upsertVerdictRow(reportId, findingId, { applied });
}

export interface PersistedFindingState {
  verdict: "up" | "down" | "na" | null;
  reason?: string;
  applied: boolean;
}

export async function getPersistedState(
  reportId: string,
): Promise<Record<string, PersistedFindingState>> {
  const d = await db();
  const idx = d.transaction(VERDICTS).store.index("reportId");
  const out: Record<string, PersistedFindingState> = {};
  for await (const cur of idx.iterate(reportId)) {
    const row = cur.value as VerdictRow;
    out[row.findingId] = { verdict: row.verdict, reason: row.reason, applied: row.applied };
  }
  return out;
}
