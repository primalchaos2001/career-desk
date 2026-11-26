# Third-party code

Code copied or adapted into Career Desk, with each project's licence beside it.
All are MIT. Exact versions were checked on 2026-11-26 (decision D-078).

| Project | Used for | Where | Version |
| --- | --- | --- | --- |
| [career-ops](https://github.com/career-ops-hq/career-ops) | Skill vocabulary and seniority detection, copied | `packages/app/src/lib/match/vendor/` | commit a8ea6d1 |
| [JobSpy](https://github.com/speedyapply/JobSpy) | Job-board search; `scrape_jobs` adapted without pandas | `tools/python/jobspy_search.py` (package installed with pip) | python-jobspy 1.5.0 |
| [RenderCV](https://github.com/rendercv/rendercv) | CV PDFs (run through its command line) | `tools/python/render_cv.py`, `packages/app/src/lib/cv/rendercv.ts` | rendercv 2.8 |
| [JSON Resume schema](https://github.com/jsonresume/resume-schema) | CV data model (ResumeDoc follows it) | `packages/core/src/resume.ts` | schema b25e3f4 |

career-ops' name and brand are covered by its trademark policy, separately from
the MIT code licence, so Career Desk does not use them. RenderCV typesets with
Typst (Apache-2.0), installed as its dependency.
