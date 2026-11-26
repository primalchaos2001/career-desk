# @tailorats/app — CV Guide

The CV Guide web app: a **TanStack Router static SPA** (Vite + React) that runs
the real analysis pipeline (`@tailorats/pipeline`) in a Web Worker, entirely in
the browser. No server runtime, no accounts, no uploads — the résumé never
leaves the tab (D-010/D-011/D-026, ported from the Lovable prototype per D-038).

- **`/`** — upload a PDF or `.tex`, pick region/role/industry/stage, get a
  report (three scores, prioritized findings, before/after rewrites). Reports
  persist in IndexedDB; history + settings pages manage local data.
- **`/harness/`** — the low-level pipeline harness (O-08). Kept as a stable
  Playwright target for `e2e/pipeline.spec.ts`; not part of the product UI.

With no LLM key configured the pipeline runs **degraded** — a real fidelity
score plus deterministic rule-pack findings; findability/impact show as "—".

## Run it

From the **repo root**:

```bash
pnpm install
pnpm dev          # http://localhost:5173 — upload a .pdf or .tex
```

Sample resumes to try live in
[`packages/core/test/fixtures/pdf/`](../core/test/fixtures/pdf/) and
[`packages/evals/golden/tex/`](../evals/golden/tex/).

## Other commands (from the repo root)

```bash
pnpm build                         # production static bundle → packages/app/dist
pnpm --filter @tailorats/app typecheck
```

From `packages/app`:

```bash
pnpm exec playwright test          # e2e against the dev server (harness + real UI)
E2E_PREVIEW=1 pnpm exec playwright test   # same, against the production build
```

## Structure

```
src/
  main.tsx            client SPA entry (mounts the router)
  router.tsx          router + QueryClient
  routes/             file-based routes (index, analyze.$reportId, history, …)
  worker.ts           runs @tailorats/pipeline analyze() off the main thread
  lib/
    analyzeClient.ts  the seam: UI context → worker → stored Report
    report.ts         app-side Report/Finding types + display labels
    reportStore.ts    IndexedDB persistence (reports + finding verdicts)
harness/              the O-08 pipeline harness (second Vite entry, /harness/)
```

`components.json` + `lib/utils.ts` (`cn`) are kept so `npx shadcn add <c>` works,
but no shadcn components are currently used — the UI is hand-written Tailwind.
