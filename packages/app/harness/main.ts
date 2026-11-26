import type { Report } from "@tailorats/core";

/**
 * Throwaway verification harness (O-08). Proves the real pipeline runs in a
 * real browser end-to-end. The production UI is the Lovable port (D-026) —
 * this page exists so the engine is browser-verified before that lands, and
 * stays as the Playwright target afterwards.
 */

// Signals to index.html's fallback check that the module system actually ran.
document.body.dataset.ready = "1";

const worker = new Worker(new URL("../src/worker.ts", import.meta.url), { type: "module" });

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const fileInput = $("file") as HTMLInputElement;
const status = $("status");
const output = $("output");

function render(report: Report, notes: string[]) {
  const scores = report.scores;
  $("scores").textContent =
    `fidelity: ${scores.fidelity ?? "–"} · findability: ${scores.findability ?? "–"} · impact: ${scores.impact ?? "–"}`;

  output.innerHTML = "";
  for (const finding of report.findings) {
    const card = document.createElement("div");
    card.className = "finding";
    card.dataset.priority = finding.priority;
    card.dataset.id = finding.id;
    card.innerHTML =
      `<strong>[${finding.priority}] ${finding.title}</strong>` +
      `<div class="layer">${finding.layer}</div>` +
      `<div class="evidence">${finding.evidence}</div>` +
      `<div class="source">${finding.source}</div>`;
    output.appendChild(card);
  }
  $("notes").textContent = notes.join(" | ");
  status.textContent = `done: ${report.findings.length} findings${report.degraded ? " (degraded)" : ""}`;
  status.dataset.state = "done";
}

worker.onmessage = (event: MessageEvent) => {
  const data = event.data as
    | { ok: true; report: Report; notes: string[] }
    | { ok: false; error: string };
  if (data.ok) {
    render(data.report, data.notes);
  } else {
    status.textContent = `error: ${data.error}`;
    status.dataset.state = "error";
  }
};

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  status.textContent = "analyzing…";
  status.dataset.state = "running";

  const context = {
    region: ($("region") as HTMLSelectElement).value,
    role: "swe-intern",
    stage: "student",
  };
  const packIds = ["stage/student", "role/swe-intern", `region/${context.region}`];

  if (file.name.endsWith(".tex")) {
    worker.postMessage({ kind: "tex", source: await file.text(), packIds, context });
  } else {
    const bytes = await file.arrayBuffer();
    worker.postMessage({ kind: "pdf", bytes, packIds, context }, [bytes]);
  }
});
