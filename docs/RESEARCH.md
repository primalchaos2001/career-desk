# Research Notes — 2026-07-06

Background research from the initial planning. Sources at the bottom.

## 1. HackerRank hiring-agent (the reference repo)

Repo: https://github.com/interviewstreet/hiring-agent (MIT, Python 3.11+)

It is a **recruiter-side** resume evaluator, not a candidate-side improver. Its
pipeline is directly reusable as a mental model for our extraction/scoring stages:

1. **PDF extraction** — PyMuPDF converts resume PDFs to markdown-ish text
   (headings, links, tables preserved).
2. **Section parsing** — Jinja-templated LLM prompts extract structured sections
   into **JSON Resume**-shaped Pydantic models (basics, work, education, skills,
   projects, awards).
3. **GitHub enrichment** — fetches the candidate's GitHub, classifies repos,
   picks top ~7 projects by commit-contribution thresholds.
4. **Evaluation** — fairness-constrained scoring across dimensions: open-source
   contributions, personal projects, production experience, technical skills.
   Base score + bonuses + deductions, with evidence-based explanations.
5. **Output** — human-readable summary + CSV; dev-mode caching of extracted JSON.

LLM backends: Ollama (local) or Gemini, behind a provider abstraction.

**What we take from it:** JSON Resume as canonical schema; Jinja-templated
prompts for provider portability; GitHub enrichment (huge for new grads);
evidence-attached scoring; dev-mode caching for cheap iteration.
**What we do differently:** we are candidate-side — output is *actionable edits*,
not a hire/no-hire score; and we add the role/industry/region context layer it
completely lacks.

## 2. Competitive landscape

### Commercial

- **Jobscan** — the keyword-match incumbent. Paste JD + resume → match rate,
  ~20 granular checks, job-level/education match. 5 free scans/month, then paid.
  Weakness: generic, single-JD focused, fear-marketing around ATS rejection.
- **Resume Worded** — "Score My Resume" (20–30 generic checks: impact, brevity,
  style) + "Targeted Resume" (JD keywords) + LinkedIn review. ~$19/mo annual.
  Weakness: generic advice, no regional/role context.
- **Teal** — free resume builder + job tracker (Chrome extension), match mode per
  bookmarked job. Best free tier, but shallow analysis.
- **Rezi, Enhancv, Kickresume, etc.** — builder-first with AI sprinkled on.

### Open source

- **srbhr/Resume-Matcher** — most-starred OSS in the space. Local-first
  "master resume → tailor per job" loop, 100+ LLMs. Keyword/similarity focused.
- **sunnypatell/ats-screener** — simulates parsing/filtering/scoring of 6 real
  ATS platforms (Workday, Taleo, iCIMS, Greenhouse, Lever, SuccessFactors);
  Gemini/Groq/Ollama backends. Built by a student "tired of paywalled checkers".
  Validates our parse-simulation idea and our audience.
- **xitanggg/open-resume** — resume builder + parser, runs fully in-browser
  (privacy angle); good reference for client-side parsing UX.
- **olyaiy/resume-lm** — Next.js 15 AI resume builder.

### Gap nobody fills (our wedge)

No tool combines: (a) role × industry × **region** context, (b) new-grad-specific
evaluation (projects/coursework/GitHub carrying the resume), (c) honest
ATS modeling instead of fear marketing, (d) an embedded LaTeX editor so
suggestions become applied edits rather than a PDF you re-upload five times.

## 3. How ATS actually work (important — reframes the product)

The "75% of resumes are auto-rejected by ATS" statistic is **unsourced folklore**
(traced to a long-defunct job-services company). Reality per recent industry
write-ups (Simplify, The Tech Resume, Rezi's experiments, HiringThing):

- An ATS is a **database + workflow tool**. It parses the resume into fields,
  stores it, and lets recruiters search/filter/rank.
- Only ~8% of recruiters enable content-based auto-rejection, and then only for
  hard knockouts (work authorization, minimum credentials). Humans review the rest.
- What actually kills resumes: (1) **parse failures** — columns, tables, text
  boxes, headers/footers, images making fields come out garbled or empty;
  (2) **not surfacing in recruiter keyword searches**; (3) **failing the human
  6-second skim** once a recruiter does open it.

**Product consequence:** our score is three honest layers — Parse Fidelity,
Recruiter Findability, Human Impact — not a fake "ATS pass/fail". This honesty is
itself a differentiator and should be stated in the UI ("what ATS really do").

## 4. Regional resume norms (core of the differentiation)

Robust, deterministic differences we can encode as rules (no LLM needed):

| Dimension | US/Canada | UK | Germany/France (EU) | India | Gulf/UAE |
|---|---|---|---|---|---|
| Name of doc | resume | CV | CV (Lebenslauf) | resume/CV | CV |
| Length (early career) | 1 page | 2 pages | 1–2 pages | 1–2 pages | 1–2 pages |
| Photo | **Never** (bias/legal) | No | Often expected (esp. DE) | Optional/common | Common |
| DOB / marital status / nationality | **Never** | No | Sometimes (DE traditional) | Common/expected | Expected |
| Spelling | en-US | en-GB | local or en-GB | en-GB (mostly) | en-GB |
| Date format | MM/YYYY | MM/YYYY | DD.MM.YYYY | varies | varies |
| Other | no "references available" | — | signature/date sometimes (DE) | declaration line common | — |

Plus role/industry layers: e.g., SWE internships (US/India) expect Projects +
GitHub link prominently; finance expects GPA; academic/research roles expect a
real CV with publications. These become versioned **rule packs** (see ARCHITECTURE).

## 5. LaTeX in the browser (feasibility: yes)

- **SwiftLaTeX** — pdfTeX/XeTeX compiled to WebAssembly; compiles fully
  client-side ("include a script tag"), output identical to TeX Live. Proven in
  several browser editors (TeXlyre, TexBrain). Fits our privacy story and avoids
  running a TeX farm server-side. Caveats: multi-MB WASM download, TeX Live
  package fetching needs a package server/CDN, project maintenance is
  fork-driven — abstract behind a renderer interface.
- **typst.ts** — Typst compiled to WASM: far lighter and faster than TeX, but
  students' muscle memory (Jake's Resume template, Overleaf) is LaTeX.
- **TeXlyre** — local-first LaTeX+Typst web editor (React + Yjs + IndexedDB);
  good architecture reference for offline-first editing.

**Recommendation:** ship LaTeX via SwiftLaTeX first (that's what the audience
uses), behind a `DocumentRenderer` interface so Typst can slot in later.

## Sources

- [interviewstreet/hiring-agent](https://github.com/interviewstreet/hiring-agent)
- [sunnypatell/ats-screener](https://github.com/sunnypatell/ats-screener)
- [srbhr/Resume-Matcher](https://github.com/srbhr/Resume-Matcher) · [origin story](https://dev.to/srbhr/creating-a-game-changer-in-job-search-an-open-source-ats-resume-matcher-31g9)
- [xitanggg/open-resume](https://github.com/xitanggg/open-resume) · [olyaiy/resume-lm](https://github.com/olyaiy/resume-lm)
- [Jobscan vs Teal](https://www.jobscan.co/blog/jobscan-vs-teal/) · [Jobscan vs Resume Worded](https://www.jobscan.co/blog/jobscan-vs-resume-worded/) · [3-way comparison](https://bestjobsearchapps.com/articles/en/jobscan-vs-resume-worded-vs-teal-pros-cons)
- [Simplify: ATS myths](https://simplify.jobs/blog/debunking-applicant-tracking-system-ats-myths) · [The Tech Resume: ATS myths busted](https://thetechresume.com/samples/ats-myths-busted) · [Rezi ATS experiment](https://www.rezi.ai/posts/ats-myths) · [HiringThing](https://blog.hiringthing.com/applicant-tracking-system-myths)
- [Resume.io international formats](https://resume.io/blog/international-resume-cv-writing) · [CareerAddict country differences](https://www.careeraddict.com/resume-differences-country-to-country) · [TopCV country guide](https://www.topcv.io/blog/resume-vs-cv-differences-by-country-2026)
- [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX) · [TeXlyre](https://github.com/TeXlyre/texlyre)
