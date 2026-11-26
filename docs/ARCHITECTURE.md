# Architecture

Architecture of the CV checker (the `/` app) that Career Desk is built on:
free-forever and local-first (D-010/D-011). Career Desk's own parts are in
[CAREER-DESK.md](CAREER-DESK.md); decisions are in [DECISIONS.md](DECISIONS.md).

## 0. The free-forever constraint (drives everything)

The product must be free for every user and ~zero recurring cost for us. That
rules out a hosted backend doing LLM calls on our dime. Consequences:

- **Everything runs in the browser.** The app is a static site (free hosting at
  any scale: Cloudflare Pages / GitHub Pages). There is no server, no accounts,
  no database. User data never leaves their machine except direct-to-LLM calls.
- **LLM = bring-your-own free option.** Gemini free tier, Groq free tier,
  OpenRouter free models, Ollama (fully local/offline), or an Anthropic key for
  those who have one. Keys live in localStorage only.
- **Deterministic layers do most of the work for $0** — parse fidelity and rule
  packs need no LLM at all; a user with no key still gets a very useful report.
- Fully open source, so anyone can self-host or fork.

This supersedes the Rev-1 FastAPI/Python design. hiring-agent's *patterns*
(JSON Resume schema, templated prompts, evidence-based scoring, caching) carry
over; its Python code does not — the pipeline is TypeScript, in the client.

## 1. System overview

```
┌──────────────────────────── Browser (everything) ────────────────────────────┐
│                                                                              │
│  INPUT      pdf.js (PDF text+geometry) · unified-latex (.tex) · mammoth      │
│             (DOCX) · GitHub REST (optional enrichment, optional PAT)         │
│                    │                                                         │
│  PIPELINE   1. ingest → ResumeDoc (canonical JSON)                           │
│  (TS, in    2. extract (LLM, structured output) — skipped if .tex/builder    │
│   a Web     3. parse-fidelity checks (deterministic)      → Layer 1 score    │
│   Worker)   4. rule-pack engine (region×role×industry×stage) → context findings │
│             5. LLM content review + JD gap analysis       → Layers 2,3       │
│             6. report: merge, prioritize P0/P1/P2, attach patches            │
│                    │                                                         │
│  OUTPUT     Report UI (3 scores + findings)                                  │
│             Editor: Monaco .tex  ◄─ "Apply fix" patches                      │
│                     Builder: form UI over ResumeDoc → generates .tex         │
│             SwiftLaTeX WASM compile → live PDF preview                       │
│                                                                              │
│  STORAGE    IndexedDB (resumes, versions, reports) — device-local only       │
│  LLM I/O    direct browser→provider: Gemini | Groq | OpenRouter | Ollama     │
│             (localhost) | Anthropic (CORS header) — BYO key in localStorage  │
└──────────────────────────────────────────────────────────────────────────────┘

  Static hosting (CF Pages/GH Pages, $0) · TeX packages via jsDelivr/CDN ($0)
  Optional: Cloudflare Worker free tier as CORS proxy iff some provider needs it
```

## 2. Monorepo layout (pnpm workspaces, TypeScript)

```
packages/
  core/        ResumeDoc schema (zod), pipeline stages, finding/report types
  rules/       rule engine + rulepacks/*.yaml compiled to JSON at build
  llm/         provider abstraction (gemini|groq|openrouter|ollama|anthropic),
               prompt templates, structured-output validation w/ retry
  latex/       DocumentRenderer interface, SwiftLaTeX wrapper, templates,
               tex patch apply (anchor-based)
  app/         CV Guide UI — TanStack Router static SPA harvested from the
               Lovable prototype (D-026); no server runtime in the artifact
  evals/       golden resume set + expected findings, scoring scripts (CI)
```

## 3. Canonical data model: `ResumeDoc`

[JSON Resume](https://jsonresume.org/) schema via **zod**, extended with:
- `projects[].githubUrl` + `enrichment` (stars, candidate commits, languages, recency)
- `education[].coursework`, `gpa` + scale
- `meta.sourceFormat` (pdf|tex|docx|builder), `meta.texSourceMap` (section → source ranges, enables Apply-fix)
- `meta.regionSignals` (photo, DOB, marital status, declaration line, spelling variant)

`.tex` and builder inputs produce `ResumeDoc` **without any LLM call** (parser /
form is the source of truth) — cheapest and most accurate path; PDF/DOCX need
one small-model extraction call.

## 4. Finding & report format (unchanged from Rev 1)

```yaml
finding:
  id: reg-us-photo-001
  layer: context          # fidelity | findability | impact | context
  priority: P0            # P0 blocker / P1 high-impact / P2 polish
  title: "Photo on a US resume"
  evidence: "Image detected in header region, page 1"
  why: "US employers discard photo resumes for bias-liability reasons"
  source: "rulepack:region/us.yaml#photo"     # or "jd:line 14" or "llm"
  suggestion: { before, after, tex_patch: {anchor, old, new} | null }
```

Report = `{ scores: {fidelity, findability, impact}, findings[], context_used }`.
Three honest scores, never a fake "ATS pass %" (RESEARCH §3).

## 5. Rule packs (the moat — unchanged, now compiled to the client)

Versioned YAML in `packages/rules/rulepacks/{region,role,industry,stage}/`,
merged stage → industry → role → region (region wins). Each rule: predicate
against ResumeDoc (JSONPath/named TS check), message, priority, **cited source**.
Non-deterministic rules compile into instructions injected into the LLM review
prompt — the LLM applies policy, never invents it. Build step compiles YAML →
JSON bundled with the app; community PRs edit only YAML.

## 6. LLM strategy (free-first)

- Provider order shown to users: **Ollama (free, private, offline)** →
  **Gemini/Groq free tiers (free key, 2-min signup, guided in-app)** →
  OpenRouter free models → paid keys (Anthropic/OpenAI) for those who have them.
- Direct browser→provider calls (all listed providers support browser CORS;
  Anthropic via `anthropic-dangerous-direct-browser-access`). If a future
  provider doesn't, a Cloudflare Worker free-tier proxy — that is the only
  server component we will ever accept, and it must stay key-less/stateless.
- Budget per analysis: ≤1 review call + ≤1 extraction call (PDF only). Prompt
  templates versioned in-repo; outputs zod-validated with retry-on-error.
- Hard rules in every prompt: never invent facts; rewrites reuse the user's
  facts only; every finding quotes its evidence span.
- **Degraded-gracefully mode:** no provider configured → deterministic layers
  still produce the fidelity + context report; LLM sections show how to enable.

## 7. Parse-fidelity checker (Layer 1, deterministic, in-browser)

pdf.js gives text runs + geometry: multi-column detection, tables/text boxes,
images (feeds photo rule), header/footer content, exotic fonts, non-standard
section headings (fuzzy match vs per-region lexicon), reading-order sanity.
Second opinion: run open-resume's browser parser and diff extractions —
disagreement = parse risk.

## 8. Editor + builder (pillar 4, both modes)

- **LaTeX mode:** Monaco + SwiftLaTeX (pdfTeX WASM), fully client-side; TeX
  packages from CDN. `DocumentRenderer` interface so typst.ts can slot in later.
- **Builder mode (for non-LaTeX students):** form UI editing ResumeDoc directly;
  rendering = fill a region/role-appropriate LaTeX template with ResumeDoc →
  same SwiftLaTeX compile. Builder users get LaTeX-quality PDFs without writing
  LaTeX, and can "eject" to raw .tex anytime. One rendering path, two UIs.
- **Apply-fix loop:** finding → tex patch (context-anchored, not line numbers) or
  ResumeDoc mutation (builder) → recompile → re-run cheap layers instantly,
  re-run LLM re-score on demand (user's key, their choice).
- PDF-only uploads: extraction pre-fills the builder → migration path into
  maintained, editable resumes.

## 9. Persistence & privacy

IndexedDB for resume versions, reports, settings; export/import as a single
JSON file (backup/device transfer). No telemetry by default; if we ever add
opt-in anonymous metrics, that's a new ADR. Privacy is a headline feature:
"your resume never touches our servers — we don't have servers."

## 10. Testing/eval strategy

- Golden set in `packages/evals`: sample resumes × contexts → expected findings.
  CI (GitHub Actions, free for OSS): deterministic layers checked exactly;
  LLM layers scored by finding-overlap using Ollama (small model) in CI, plus a
  manual pre-release run against a stronger model.
- Every rule ships with positive + negative fixtures; prompt changes require a
  golden-set diff in the PR.
