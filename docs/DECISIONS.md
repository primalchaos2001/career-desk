# Decision log

Short record of the main design decisions. Code comments refer to these numbers
(for example "D-044"). Earlier entries cover TailorATS, the browser-only CV
checker Career Desk grew out of; the Career Desk entries (D-071 onwards) are
written out in full below.

| # | Date | Decision |
|---|---|---|
| D-001 | 2026-07-06 | Working directory lives in WSL Ubuntu |
| D-002 | 2026-07-06 | Positioning: context-aware + honest-ATS + new-grad + closed-loop editor |
| D-003 | 2026-07-06 | Canonical schema = JSON Resume + extensions, via Pydantic |
| D-004 | 2026-07-06 | Stack: Python 3.12 + FastAPI backend, Next.js frontend |
| D-005 | 2026-07-06 | Context knowledge = versioned YAML rule packs, LLM applies but never invents policy |
| D-006 | 2026-07-06 | LaTeX in browser via SwiftLaTeX WASM, behind DocumentRenderer interface |
| D-007 | 2026-07-06 | LLM strategy: Claude-first with provider abstraction, structured outputs, golden-set evals |
| D-008 | 2026-07-06 | MVP scope: regions India+US, roles SWE-intern + data, PDF+.tex input, CLI/API before UI |
| D-009 | 2026-07-06 | Privacy default: stateless MVP, files not retained post-analysis |
| D-010 | 2026-07-06 | Free forever, fully open source |
| D-011 | 2026-07-06 | Architecture pivot: static-site, everything in the browser |
| D-012 | 2026-07-06 | Launch scope: all four questions answered inclusively |
| D-010b | 2026-07-06 | Parallel work split: Antigravity (Windows) does scruff work on feature branches |
| D-013 | 2026-07-06 | Phase 0 executed by Claude; Antigravity board rebased onto the TS architecture |
| D-014 | 2026-07-06 | Phase-0 tooling: pnpm + vitest + Biome + tsc, no build step yet |
| D-015 | 2026-07-06 | Rule conditions = named TS checks (no DSL); deterministic evals held to exact match |
| D-016 | 2026-07-06 | Improvement loop: user-carried feedback via GitHub, donation-grown golden set, eval ratchet |
| D-017 | 2026-07-06 | Domain taxonomy: sub-domains are role packs, culture lives in industry packs |
| D-018 | 2026-07-06 | Pre-launch tracking ledger: manual, maintainer-run, private Google Sheet |
| D-019 | 2026-07-06 | Phase-1 parallel split: Opus builds the pipeline, Antigravity builds pack/eval breadth |
| D-020 | 2026-07-06 | O-01 ingest decisions: pdfjs-dist legacy build, pdf-lib-generated fixtures, page-1-image photo heuristic |
| D-021 | 2026-07-06 | O-02 fidelity scoring formula and heuristics |
| D-022 | 2026-07-07 | Agent workflow skills committed in .claude/skills/ |
| D-023 | 2026-07-07 | O-03 .tex ingest: unified-latex AST walk; A-04 fixture corrections |
| D-024 | 2026-07-07 | O-04 LLM layer: raw-fetch clients, free-first order, retry-once structured outputs |
| D-025 | 2026-07-10 | O-06 pipeline: own package (not core), LLM-owned findability/impact scores, degraded floor |
| D-026 | 2026-07-10 | Phase-2 UI = harvest the Lovable prototype (TanStack Router static SPA), amending D-011's Next.js choice |
| D-027 | 2026-07-06 | Data-driven evaluation contexts in expected/cases.yaml |
| D-028 | 2026-07-06 | Parameterized generic keyword checks |
| D-029 | 2026-07-06 | Finance and Investment Banking rule packs |
| D-030 | 2026-07-06 | Regional and engineering golden set expansion |
| D-031 | 2026-07-10 | Browser-loadable rule packs: YAML compiled to a checked-in generated/packs.json |
| D-032 | 2026-07-10 | CI lint gate was silently red; fixed and de-masked |
| D-033 | 2026-07-10 | Browser verification harness: the pipeline is now proven in a real browser, not assumed |
| D-034 | 2026-07-10 | CI entrypoints repaired; verification must run the commands CI runs |
| D-035 | 2026-07-10 | Engineering and Consulting Rule Packs (A-09 & A-10) |
| D-036 | 2026-07-10 | Dev-server guard + fix for the cold-cache e2e flake |
| D-037 | 2026-07-10 | ADR ids are assigned by the merger, not the author |
| D-038 | 2026-07-11 | Lovable port (O-12): TanStack Start SSR → plain TanStack Router SPA, mock→worker seam, and scaffold prune |
| D-039 | 2026-07-11 | Deterministic scoring engine (O-13): per-section + overall scores from impact/findability analyzers |
| D-040 | 2026-07-11 | Deterministic PDF → ResumeDoc extraction |
| D-041 | 2026-07-11 | Generic .tex extraction — custom envs, plain itemize, table skills/education, and contact hardening (B-3/A-14) |
| D-042 | 2026-07-11 | Per-section strengths/gaps readout vs a role benchmark (B-1) |
| D-043 | 2026-07-11 | Role differentiation (A-12) + an MBA-applicant pack (B-2) |
| D-044 | 2026-07-12 | Report-quality feedback batch: keywords are a plus not a checklist, India accepts either spelling, evidence stays short, US-only rules region-gated |
| D-045 | 2026-07-12 | A-14 landed by hand-reconciliation, not merge — feat/a12-a13-data-enrichment reverted D-041 on its own branch |
| D-046 | 2026-07-12 | role/dv-engineer rule pack and wrapped PDF header line merging (A-15, A-16) |
| D-047 | 2026-07-12 | Design harvest round 2 from the Lovable `cv-guide` repo |
| D-048 | 2026-07-13 | Improvement loop C1/C3: verdict+reason and issue-composer links |
| D-049 | 2026-07-13 | On-device LLM review: Qwen3-1.7B via transformers.js, automatic, no API key |
| D-050 | 2026-07-13 | O-14 landed: LocalProvider, testing strategy revised from D-049's plan, a resolveProvider gap surfaced |
| D-051 | 2026-07-13 | LocalProvider: pin device="cpu" under Node, "auto" only in-browser |
| D-052 | 2026-07-13 | O-15 landed: resolveProvider resilience, includeLocal opt-in (not a blind default), a Vite worker-dep reload fixed for real |
| D-053 | 2026-07-13 | MBA applicant rule pack and custom checks (A-17) |
| D-054 | 2026-07-14 | O-16: progressive AI review UX + a real hard-timeout robustness fix |
| D-055 | 2026-07-13 | Product Manager rule pack and checks (A-18) |
| D-056 | 2026-07-14 | AI review becomes an opt-in button, not automatic |
| D-057 | 2026-07-14 | O-20 enrichment merge semantics |
| D-058 | 2026-07-14 | Default on-device model drops to Qwen3-0.6B |
| D-059 | 2026-07-14 | Cap the enrichment prompt's size — real browser-crash fix |
| D-060 | 2026-07-15 | Local model comparison results for on-device AI review (O-18) |
| D-061 | 2026-07-16 | Settings key silently overrode the on-device button |
| D-062 | 2026-07-16 | Stall timeout gets a per-token progress signal during generation |
| D-063 | 2026-07-16 | Enrichment maxTokens restored to 1024 — undocumented cut was truncating JSON |
| D-064 | 2026-07-16 | Impact findings quote a real bullet in evidence, not just a count |
| D-065 | 2026-07-16 | maxTokens bumped to 1536 + suggestion.before capped to one quote — D-064 made evidence longer |
| D-066 | 2026-07-16 | "AI-enriched" badge no longer shown for a no-op enrichment |
| D-067 | 2026-07-16 | AI-review e2e timeouts bumped to 900s/960s — measured, not guessed |
| D-068 | 2026-07-17 | Salvage complete elements from truncated enrichment JSON instead of discarding the whole response |
| D-069 | 2026-07-17 | Enrichment maxTokens lowered 1536→1024, following through on D-068 |
| D-070 | 2026-07-17 | Visible "no GPU detected" hint on the AI review button — B-6 |
| D-071 | 2026-11-10 | Career Desk companion workspace |
| D-072 | 2026-11-10 | Downloadable local companion direction |
| D-073 | 2026-11-10 | Preserve Claude's shared-folder and MCP prototype |
| D-074 | 2026-11-11 | Assisted applying and approved cold outreach |
| D-075 | 2026-11-11 | Local launcher with connection status |
| D-076 | 2026-11-26 | One-click "Find jobs" through the user's own assistant |
| D-077 | 2026-11-26 | Career Desk split into its own repository |
| D-078 | 2026-11-26 | Smart matcher, job-board search and CV PDFs from open-source projects |
| D-079 | 2026-11-26 | One-download install, first-run guide, CV builder, morning search, email ownership |
| D-080 | 2026-11-26 | Recruiter email finder: published addresses only |
| D-081 | 2026-11-26 | Send yourself from Gmail, no setup |
| D-082 | 2026-11-26 | Find jobs with Claude Code as well as Codex |

## Career Desk decisions

### D-071 · 2026-11-10 · Career Desk companion workspace

The maintainer approved the job-search companion proposal and asked to fully build it.
Extend the existing static React app at /workspace, preserving the ATS analyzer
at /. Reuse ResumeDoc and deterministic extraction. A separate IndexedDB store
holds profiles, campaigns, jobs, applications, templates, sessions and events.
A campaign is a search direction; a session is a run. D-010/D-011 remain in force.

First assistant integration is a portable ZIP containing validated workspace.json,
JSON Schema, workflow/skill instructions and application text files. Codex and
Cowork consume the folder through their own authorized capabilities. A live MCP
connection, mailbox access and unattended runtime are not implied. Remote MCP and
an operator-funded execution backend remain outside this implementation.

Use fflate for browser ZIP handling. Imports inflate only workspace.json with
size limits, validate record references, preview replacement and reject stale
revisions unless the user explicitly chooses backup restoration. IndexedDB
transactions reject conflicting tab writes. One assistant writer per export
avoids a premature distributed merge system.

Matching is deterministic preference coverage, not hiring probability or clinical
eligibility. Required credentials/languages are explicit posting inputs; missing
facts trigger review. Confirmed outcomes require evidence. Profile and document
snapshots preserve prior applications; shared CV attachments avoid duplication.
The static app does not submit applications or send mail; external assistant
actions require host capabilities and the user's authorization.

Publish a separate owner-private static Site, preserving the existing CV Guide
deployment. Candidate records are never embedded in source or deployment.

### D-072 · 2026-11-10 · Downloadable local companion direction

The maintainer reported that export/import is not automatic and requested a GitHub-
distributed PC application that people install and connect, plus README files.
The browser-only boundary remains for the standalone ATS app. The requested
optional PC companion may run locally; it must not introduce operator-funded
hosting/inference or claim that GitHub runs each user's searches. This is an
explicit scope extension beyond D-071's file-handoff implementation.

The recommended design is one local store accessed through domain commands by
the UI, MCP adapters and an optional runner. Live results replace file copies;
exports remain backups/migration. SQLite, the desktop shell, installer, migration,
host packages and runner still need implementation and validation. These README
specifications do not make them shipped features. Preserve existing profiles
and the browser analyzer when that work begins.

Distinguish live storage, assistant-driven runs and scheduled execution. An MCP
connection supplies tools, not an inference provider, browsing or a scheduler.
Document separate access to the user's chosen model and mail provider. Consumer
subscriptions are not implicit API credentials. Check host compatibility using
official sources; Cowork local plugin servers and cloud custom connectors use
different paths. Existing live mail/submission controls remain required.

Alternatives: retaining repeated ZIP handoffs does not solve the reported
friction; a multi-tenant cloud runner changes cost and data-handling obligations;
a local companion is the recommended first direction. The first acceptance test
is a clean-PC install, one connection and a real research run whose results appear
in the UI with no export/import. See docs/connections for the connector. No new executable or service was
implemented as part of this documentation update.

### D-073 · 2026-11-10 · Preserve Claude's shared-folder and MCP prototype

Claude added a WorkspaceStore interface, linked-folder HTTP API for Vite dev and
preview, browser file-event subscriptions and a local stdio MCP adapter with
eight domain tools. The local prototype now removes repeated ZIP handoffs;
static hosting retains IndexedDB and reviewed import/export. Keep this work and
update the D-072 implementation order rather than rebuilding the same layers.
SQLite remains an option to evaluate against measured concurrency needs, not an
implemented dependency. The standalone ATS build remains static.

The app and MCP process must share the same data folder. MCP writes validate the
workspace and use the shared lock/revision check. Direct assistant edits bypass
that lock, so document a single writer for this fallback. HTTP API full-schema
validation, live-event recovery, concurrent writes and permissions on existing
application updates need further tests before a broader release claim.

Review evidence: 4 folder API tests and 8 MCP tests passed, app typecheck and MCP
bundle build passed, and the built process answered initialize/tools-list over
stdio. This is not full CI or verification inside an actual assistant host.
Installer, independent research worker, scheduler and mail/submission adapters
were still absent at this point (later decisions add several). Preserve
earlier ADRs and verification records as history rather than rewriting them.

### D-074 · 2026-11-11 · Assisted applying and approved cold outreach

The maintainer asked for applications to be submitted on the user's behalf and for cold mailing
of HR contacts with the cover letter and CV. Codex now offers browser control
and Windows computer use, so a supervised version is feasible.

Assisted applying: the user approves a specific prepared application in the app
("ready for form filling"). Only then does the MCP tool `get_apply_packet`
return the facts, documents and CV file the assistant may enter into that
employer's form. The assistant fills the form, stops before the final submit and
lets the user submit. Outcomes are recorded with update_application; applied
still needs a confirmation reference. No unattended submission.

Cold outreach: contacts hold a business email and the public source URL where it
was found (job post, careers page, published recruiter address). No phone
numbers, no bulk scraping of LinkedIn or people databases, no guessed addresses;
contacts can be marked do-not-contact. Drafts come from the outreach template.
Each email must be approved in the app before `get_send_queue` returns it.
Tool code enforces: draft/authorized campaign mode, at most 15 sends per day,
one email per contact per 14 days, no email to do-not-contact contacts, and
"sent" only for approved drafts with a provider message reference. Sending uses
the user's own mail account through the assistant's mail tools or a downloaded
.eml file; Career Desk stores no mail passwords.

Reasons: job boards prohibit automated applying; application forms contain
attestations the user must own; India's DPDP Act and anti-spam rules make
harvested personal numbers and untargeted bulk mail risky; small, approved,
sourced outreach gets better replies. Approvals live in the workspace file, so a
host that edits workspace.json directly can bypass them. Document that the MCP
tools, not direct file edits, are the supported path.

Addendum 2026-11-11 (claims check): drafts are checked against the profile and
CV text before approval (`src/lib/claims.ts`). It flags leftover placeholders,
experience above the profile figure, degrees/subjects, named tools, employers and
figures the profile does not contain. Placeholders block approval; other items
are warnings shown in the app and returned to assistants as claimWarnings. It
checks support, not truth: it compares against the profile, so a wrong profile
figure (e.g. experienceYears) is not caught.

### D-075 · 2026-11-11 · Local launcher with connection status

Before the Windows installer (implementation plan task 4), provide one
double-click start that needs no pnpm, Vite or terminal: `Career Desk.cmd` runs
a bundled local server (`packages/app/dist-local/career-desk.mjs`) with any
Node 20+ it finds (PATH, else the Node runtime shipped with Codex). The server
binds 127.0.0.1 only, serves the built static app, and mounts the same
linked-folder API the dev server uses (shared module, same validation, lock and
backups). If Career Desk is already running it just opens the browser.

A status endpoint and an Assistants-page panel show: storage folder and
revision, live connection, connector build, and whether Codex, Claude Code, the
Claude desktop app and Gemini CLI have a `career-desk` MCP entry pointing at
this connector and folder. Detection only reads their config files; Career Desk
does not edit assistant configuration and instead shows the setup command.
"Test connection" starts the real connector process, runs initialize, tools/list
and the read-only get_overview, and passes only if it reports the same workspace
revision the app shows. No test data is written.

Not an installer: it still needs this checkout, a Node runtime and built files.
The static ATS build and dev workflow are unchanged.

### D-076 · 2026-11-26 · One-click "Find jobs" through the user's own assistant

The research worker (implementation plan task 3) runs the user's own signed-in
assistant unattended, rather than a Career Desk model or API key. First adapter:
`codex exec` (ChatGPT sign-in), found as the newest
`%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` or `codex` on PATH, because the
Codex app updates itself into new folders. Claude Code (`claude -p`) and
Antigravity (`agy`) can be added as adapters later; they are not installed here.

Each run: `--search` (live web search), `--sandbox read-only` (no file or shell
changes), `--ephemeral`, and a per-run override that starts the Career Desk
connector with `--research-only --campaign <id>`: only get_overview, list_jobs,
get_job, add_job, update_job and save_session, and writes only to that
campaign. Applications and email are impossible in a run whatever the campaign
mode. One run at a time per workspace folder; Stop kills the process tree; a
15-minute cap. Progress comes from Codex's JSONL events; job counts come from
the workspace itself. Run records (status, steps, outcome) are kept in
`<folder>/runs/` outside the workspace schema.

Verified before building: a manual `codex exec` run on a scratch copy found and
saved one live employer listing with no approval prompts. Runs use the user's
ChatGPT plan allowance.

### D-077 · 2026-11-26 · Career Desk split into its own repository

Career Desk no longer fits TailorATS's promise ("browser-only, your resume
never leaves your device"): it runs a local server, starts the user's assistant
and drafts and sends email. It was split from `feat/job-search-workspace`
(commit af6c5e4) into this repository, keeping the shared history. TailorATS
keeps its own main branch, Cloudflare/OpenAI hosting configs and promise.

Here: root package renamed `career-desk`; TailorATS hosting configs
(`wrangler.jsonc`, `.openai/hosting.json`) removed so this repo can't deploy over
the CV Guide site. The CV-reading
packages are copied (`@tailorats/*` names kept to avoid a broad rename). If both
projects keep developing them, publish them as a shared package later. The repo
should be private while it holds outreach and automation work in progress.

### D-078 · 2026-11-26 · Smart matcher, job-board search and CV PDFs from open-source projects

The maintainer asked to reuse other open-source job-search projects where their licences
allow it, and to make matching work without an LLM. Licences were checked at
the exact versions used; all are MIT (Typst, used by RenderCV, is Apache-2.0).
AIHawk-style AGPL code and auto-submit tools were not used. Notices are in
`third_party/`.

- **Smart matcher** (`packages/app/src/lib/match/`): replaces the old
  substring `matchJob`. Deterministic and explained: skills split into required
  and nice-to-have from the posting's sections, related skills from the same
  rule-pack group get half credit, TF-IDF cosine similarity with IDF from the
  saved postings, title/location/keywords/salary/experience from the campaign.
  Signals without data don't count. Ineligible only on hard problems (excluded
  term, missing mandatory credential or language, experience gap over two
  years or unknown). The skill vocabulary and seniority detector are copied from
  career-ops (skill-extract.mjs, jd-similarity.mjs at a8ea6d1); the rule packs
  add DV/VLSI, finance, consulting, product and mechanical skills. Output adds
  `breakdown`, `skills` (matched/related/missing) and `keywordsToAdd`.
- **Job boards** (JobSpy 1.5.0): `tools/python/jobspy_search.py` calls JobSpy's
  scrapers directly without pandas (Windows Application Control blocked pandas'
  compiled files on first use). Exposed as the `search_job_boards` connector
  tool (allowed in research-only Find jobs runs) and a Job boards panel on
  Opportunities. Leads are ranked by the matcher and saved unverified, only when
  picked (or with `save: true`).
- **CV PDFs** (RenderCV 2.8): ResumeDoc is already JSON Resume, so
  `src/lib/cv/rendercv.ts` maps it field for field; people without a CV get a
  starter CV from the Profile form. Tailoring for a job only reorders skills and
  bullets; nothing is added or reworded. Exposed as the `render_cv` connector
  tool (writes to the outbox for attaching), a CV-as-PDF panel on My profile and
  a Tailored CV PDF button on each job.

Python lives in `<repo>/.venv` (or `CAREER_DESK_PYTHON`);
`pip install -r tools/python/requirements.txt`. Verified: 75 unit tests
(including a real RenderCV render), a live run of the built connector on a
scratch workspace (12 postings from LinkedIn and Indeed in 8 s, 3 saved, a
tailored PDF written) and the Job boards, CV and match panels in the browser.
Job-board scraping can break when boards change their pages, and each board's
terms apply; it is research only and never signs in or applies.

### D-079 · 2026-11-26 · One-download install, first-run guide, CV builder, morning search, email ownership

Goal: a new person goes from download to ranked jobs without developer steps.

- **Download:** `.github/workflows/release.yml` (on a `v*` tag) tests, builds, adds a
  checksum-verified portable Node and attaches `CareerDesk-windows.zip` to a GitHub
  release (`scripts/package-windows.mjs` assembles it; `release/` is ignored).
  `Career Desk.cmd` prefers that Node, and on first start creates `.venv` and installs
  the Python tools if Python 3.10+ exists; without Python everything except job boards
  and CV PDFs still works. The launcher now opens the Overview.
- **First-run guide** (`FirstRun.tsx`, shown while there are no campaigns): 1) add a CV
  or build one, 2) role, city, expected salary (LPA; stored as the profile's expected
  CTC and the campaign minimum), 3) search now. Skills and years come from the CV
  (`lib/onboarding.ts`: skills named anywhere in it; years from dated roles, overlaps
  once, internships excluded; a CV with education but no jobs counts as 0).
- **CV builder** (`CvBuilder.tsx`, `lib/cv/builder.ts`): a form, four ready RenderCV
  layouts with preview images (fictional sample person), or a copy-paste prompt for
  ChatGPT/Gemini/Antigravity that forbids invented facts, whose JSON reply is
  validated as ResumeDoc. Saving stores the CV and its PDF in the profile so
  applications and emails can attach it.
- **Morning search** (`lib/schedule.ts`, `server/scheduler.ts`): daily at 09:00 for
  the first 7 days, then the user is asked (on the last day and after it ends) to
  extend by 3 days at a time. Job boards cost nothing; the assistant search is a
  separate opt-in labelled as using the user's plan allowance. Runs in the launcher
  while it is open, claims each day before searching, saves at most 10 eligible
  leads scoring ≥55, unverified. Optional "start with Windows" writes one file in
  the user's Startup folder, only on their click.
- **Email ownership:** emails are drafted only from a template the user saved as their
  own wording, or written by the assistant (marked as such). Approving needs an
  explicit "I read this, every fact is true, and I am the one sending it" tick
  (`approveOutreach(..., { reviewed: true })`).
- **Matcher:** "sr" counts as senior; senior titles need 2+ years and staff/lead 5+,
  else ineligible (a fresher test run saved Staff and Sr Lead roles before this).

Verified: 85 unit tests; the packaged folder started on a clean workspace with its
own Node, set up Python in ~35 s, and the guide went from no CV to a saved CV PDF,
a campaign and 7 matches from 45 live postings with the morning search on.
The GitHub workflow itself has not run yet (needs a tag push).

### D-080 · 2026-11-26 · Recruiter email finder: published addresses only

Context: cold email needs a recruiter's address per job. Paid finders guess
addresses from name patterns and people-search data, which we said assistants
must never do.

Decision: `lib/contacts/finder.ts` (pure) + `server/discovery/contacts.ts` (fetch)
report only addresses that are published, each with the page it is on:

- Sources: the saved job description; the live job post when it is on the
  employer's site or a careers system (never LinkedIn/Indeed/Naukri pages); and
  up to ~10 pages of the employer's own site (/careers, /jobs, /contact, /about,
  the home page and the careers/contact links it has). robots.txt is respected,
  private and local network addresses are refused, plain GET with an honest
  user agent.
- The employer's site comes from `job.website` (new field; Indeed's
  `company_url_direct` fills it), the job link when it isn't a board, or a link
  in the post naming the company. Never built from the company name.
- Reads mailto links, Cloudflare-protected addresses and "[at]/[dot]" hiding.
  Drops no-reply, support, sales, privacy and similar inboxes, image/asset
  names and placeholder domains. Site pages count only for the employer's
  domain (plus domains it redirects to, for rebrands); free-mail addresses only
  from the job post, with a warning.
- Ranked: named recruiter in the post > recruiting inbox (hr@, careers@...) >
  other person > general inbox (info@, with a "may be ignored" note). An MX
  check says whether the domain takes email.
- The user saves each one with "I checked it" (`addContact`, sourceUrl = page);
  assistants get `find_contacts` and still save with `add_contact`.

Verified: 9 unit tests with recorded pages; live on three Indian semiconductor
firms: hr@ found on one careers page, a talent-acquisition address on a rebranded
site, only general inboxes on the third.

### D-081 · 2026-11-26 · Send yourself from Gmail, no setup

Context: the user wants approved emails to go out through Gmail. Gmail's API
needs each user to create a Google Cloud OAuth client, which is too much for a
new user, and an app that sends for them makes us responsible for the send.

Decision: approved emails get **Open in Gmail**: it claims the email (so no
assistant sends it too), opens Gmail's compose window with recipient, subject
and body filled in (`gmailComposeUrl`, with `authuser` set to the profile email
for people signed in to several accounts) and saves the frozen CV copy to
Downloads to attach. The user presses Send and confirms it in the app; emails
too long for a link fall back to the .eml download. Assistants with a Gmail
connector may create a Gmail draft instead of sending, recorded as `unknown`
until the user confirms.

### D-082 · 2026-11-26 · Find jobs with Claude Code as well as Codex

Decision: `server/runner.ts` runs either assistant the user has installed and
signed in to. Claude Code runs as `claude -p --output-format stream-json` with
a per-run MCP config file (`runs/config/`) holding only the research-limited
Career Desk connector for one campaign, `--strict-mcp-config` so no other
servers load, `--allowedTools mcp__career-desk,WebSearch,WebFetch` and Bash,
Edit, Write, NotebookEdit and Task disallowed. Its tool-call and tool-result
events are paired into the same progress steps as Codex's. "Not logged in"
turns into "run claude in a terminal and sign in".

Found: native installer (`~/.local/bin`), PATH, or npm's `cli.js` (run with
Node, since `claude.cmd` needs a shell). The copy bundled inside the Claude
desktop app is skipped: run on its own it reports "Not logged in".

Verified with a recorded stream-json stand-in (3 tests) and the real CLI's
flag list; a live Claude Code run needs a signed-in standalone install, which
this PC doesn't have.
