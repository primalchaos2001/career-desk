# The Improvement Loop — learning without a server

ADR D-016. Problem: how does a zero-server,
no-telemetry product (D-009/D-010/D-011) learn from real usage and keep its
golden baseline honest? Answer: **the user is the transport, GitHub is the
database, the eval harness is the ratchet.**

These are the **self-serve** channels: every one is started by the user, and
nothing is sent without them reviewing it on GitHub first.

## 1. Four channels, all user-initiated, all through GitHub

### C1 — Per-finding feedback (cheapest signal)
Every finding in the report UI gets 👍 / 👎 / "not applicable to my region-role"
with an optional one-line reason.
- Stored in IndexedDB immediately (also personalizes locally: a dismissed
  finding stays dismissed for that resume).
- A "Share feedback" button batches pending feedback into a **pre-filled
  GitHub issue** (`feedback` label) containing only: rule ids, verdicts,
  reasons, context (region/role/stage), app version. Never resume content.
  The user sees the exact issue text before submitting — the transport is
  their own GitHub account, so consent is structural, not a checkbox.

### C2 — Resume donation (grows the golden set with real data)
"Donate this resume to the test suite" flow:
1. Client-side anonymizer rewrites the ResumeDoc: name/email/phone/links →
   realistic placeholders; employers/schools → fictional equivalents from a
   wordlist; free text scanned for leftover tokens of the replaced values.
2. User reviews the anonymized JSON diff in the UI and can edit it.
3. Submit = pre-filled GitHub issue (`donation` label) with the JSON +
   the context they were applying under + optionally what the report missed.
Maintainers triage donations into `packages/evals/golden/` via normal PRs
(D-015 forces expectations to be written for every added resume).

### C3 — "Report a miss" (negative examples, highest value)
One click on "the report missed something / got something wrong" opens a
pre-filled issue asking: what did a human reviewer/recruiter flag that we
didn't (or vice versa)? These become regression cases: fix the rule/prompt,
add the golden case, eval must pass — the miss can never recur silently.

### C4 — Community packs (domain knowledge inflow)
RESEARCH-DOMAINS.md gives the pack roadmap; CONTRIBUTING (Phase 2 task) will
document the bar: cited sources, pos/neg fixtures per rule, ≥1 golden resume
per pack. Domain experts (an MBA career coach, a nursing preceptor) can
contribute YAML without touching TS.

## 2. Golden-baseline governance (the ratchet)

- **Composition target:** per (region × role) context ≥5 golden resumes:
  ≥1 clean, ≥2 with known violations, ≥1 donated/real-derived, ≥1 adversarial
  (parse-hostile layout, once Phase-1 ingest lands).
- **Labeling:** expected findings are written by the PR author and verified in
  review against rule sources — never by running the engine and pasting its
  output (that would only enshrine current behavior).
- **Ratchet property:** golden cases are append-mostly. Removing/weakening an
  expectation requires an ADR reference in the PR. Rules can't be tuned to
  pass evals by deleting the evidence.
- **LLM layers (Phase 1+):** scored by finding-overlap, not exact match;
  prompt changes require a golden-set diff posted in the PR. Periodic manual
  audit: sample N donated resumes, have a maintainer hand-review the LLM
  findings, file misses as C3 regression cases.

## 3. What "learning from uploads" means here, honestly

We do NOT silently train on user resumes — no server to do it, and it would
torch the trust positioning (D-002). "Learning" is:
- **locally:** per-user personalization in IndexedDB (dismissals, re-score
  history, which suggestions get applied — the app adapts its report ordering
  to that user without anything leaving the device);
- **globally:** donated resumes + feedback issues + misses → maintainer triage
  → rule/prompt/golden changes → eval ratchet → release. A data flywheel where
  every datum was hand-carried by a consenting user through their own GitHub
  account. Precedent: privacy-first products treat verifiability-not-promises
  as the differentiator ([Brave P3A](https://brave.com/blog/privacy-preserving-product-analytics-p3a/)
  shows even opt-in aggregate analytics needs heavy machinery — GitHub issues
  are simpler and fully transparent).

Non-GitHub users (many students): the same flows export a JSON/text blob with
a "email it to us / paste in the campus Discord" fallback. Low-tech beats
no-signal.

## 4. Build order

- Phase 2 (report UI): C1 verdict buttons + IndexedDB store + issue composer;
  C3 button. Issue templates (`feedback.yml`, `donation.yml`, `miss.yml`) in
  `.github/ISSUE_TEMPLATE/` can land now.
- Phase 2.5: C2 anonymizer (`packages/core` pure function + tests — the
  anonymizer itself gets golden tests: no original token may survive).
- Ongoing: C4 via CONTRIBUTING + pack roadmap in RESEARCH-DOMAINS.md §3.
