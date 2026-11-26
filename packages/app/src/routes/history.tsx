import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Report } from "@/lib/report";
import { REGION_LABELS, ROLE_LABELS } from "@/lib/report";
import { clearAll, deleteReport, listReports } from "@/lib/reportStore";

export const Route = createFileRoute("/history")({
  component: History,
});

function History() {
  const [reports, setReports] = useState<Report[] | null>(null);

  const refresh = useCallback(async () => {
    setReports(await listReports());
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onDelete(id: string) {
    if (!confirm("Delete this report?")) return;
    await deleteReport(id);
    await refresh();
  }
  async function onClear() {
    if (!confirm("Delete ALL reports from this browser? This can’t be undone.")) return;
    await clearAll();
    await refresh();
    toast.success("Cleared");
  }

  return (
    <div className="container-page py-16">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Your past reports</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Saved in this browser only. Clearing site data deletes them.
          </p>
        </div>
        {reports && reports.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Clear all
          </button>
        )}
      </div>

      {reports === null && <p className="mt-8 text-muted-foreground">Loading…</p>}

      {reports && reports.length === 0 && (
        <div className="mt-12 rounded border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground">No reports yet.</p>
          <Link to="/" className="mt-4 inline-block text-primary underline underline-offset-4">
            Analyze a résumé →
          </Link>
        </div>
      )}

      {reports && reports.length > 0 && (
        <ul className="mt-8 grid gap-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded border border-border bg-card p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <Link
                  to="/analyze/$reportId"
                  params={{ reportId: r.id }}
                  className="font-serif text-lg hover:underline underline-offset-4"
                >
                  {r.filename}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground truncate">
                  {new Date(r.createdAt).toLocaleString()} · {REGION_LABELS[r.contextUsed.region]} ·{" "}
                  {ROLE_LABELS[r.contextUsed.role]}
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  {r.scores.fidelity ?? "—"} · {r.scores.findability ?? "—"} ·{" "}
                  {r.scores.impact ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(r.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
