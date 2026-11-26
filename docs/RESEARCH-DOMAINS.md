# Research: Domain & Sub-domain Resume Conventions — 2026-07-06

Feeds the rule-pack taxonomy (ADR D-017) and the Phase-4
pack roadmap. Every convention below is citable — packs built from this doc
must carry these URLs in `rule.source`.

## 1. Taxonomy

Two pack axes already exist (`role/`, `industry/`); domains map onto them:

- **industry packs** carry culture-level conventions (finance is conservative:
  no photos/colors; design tolerates visual resumes; academia wants CVs).
- **role packs** carry position-level requirements (IB analyst: deal bullets
  with $ sizes; nursing new-grad: clinical rotations + licensure block;
  SWE intern: projects + GitHub).
- Sub-domains = more role packs (`role/mech-engineer-intern`), not a new axis.
  Merge order (stage → industry → role → region) already handles conflicts.

## 2. Domain findings

### 2.1 Business / MBA
- One page is universal for MBA admissions and post-MBA recruiting — treated
  as a test of prioritization itself ([MBA Schools guide](https://www.mbaschools.org/resources/resume-guide/)).
- Conservative format: common serif/sans fonts, no text boxes, no shading
  ([HBS alumni guidance](https://www.alumni.hbs.edu/careers/job-search/Pages/resumes-and-cover-letters.aspx), [resumegenius on the "Harvard format"](https://resumegenius.com/blog/resume-help/harvard-resume)).
- No high school; work experience emphasized over academics; an
  "Additional / Leadership & Interests" section is expected and actually read
  ([MBA Protocol](https://mbaprotocol.com/articles/applying/mba-resume/format-mba-resume/)).
- Admissions vs recruiting nuance: admissions wants breadth + leadership
  arc; recruiters want function-relevant accomplishments. → two contexts
  (`role/mba-admissions`, `role/mba-associate`) sharing an industry pack.

### 2.2 Finance / Investment Banking
- Hard one-page rule; conservative culture "laughs at photos, emojis, colors"
  especially in the US ([M&I resume template](https://mergersandinquisitions.com/free-investment-banking-resume-template/)).
- **GPA must be listed** — 3.5 is the informal bulge-bracket cutoff and
  omission is read as "below 3.5" ([M&I](https://mergersandinquisitions.com/investment-banking/recruitment/resumes/), [CFI checklist](https://corporatefinanceinstitute.com/resources/career/investment-banking-resume/)).
- Deal/transaction bullets need size ($), rationale, and the candidate's
  specific workstream; 2–4 major experience entries
  ([M&I](https://mergersandinquisitions.com/investment-banking/recruitment/resumes/), [WSO template](https://www.wallstreetoasis.com/resources/templates/word-templates/investment-banking-resume-template)).
- Checkable rules: gpa-missing→P1 (upgrade from stage pack's P2),
  photo→P0 regardless of region, one-page→P0, deal bullets without numbers.

### 2.3 Consulting (MBB)
- One page, single column; screeners look for structured problem-solving,
  leadership, and quantified impact in <10s
  ([strategycase, ex-McKinsey screener](https://strategycase.com/consulting-resume/), [IGotAnOffer](https://igotanoffer.com/blogs/mckinsey-case-interview-blog/consulting-resume)).
- Academics: top 5–10% of class expected; GPA is an early filter.
- New grads: evidence of "making things better" anywhere — campus leadership,
  student startup, research with analytical rigor ([hackingthecaseinterview](https://www.hackingthecaseinterview.com/pages/mckinsey-resume)).
- Quantified bullets correlate with ~40% higher callback per recruiter surveys
  cited by [caseinterviewhub](https://www.caseinterviewhub.com/post/perfect-consulting-cv-mckinsey-bcg-bain).
- Checkable rules: quantify-ratio stricter (minRatio ~0.3), gpa P1,
  leadership-section-missing P1, one-page P0.

### 2.4 Engineering (core: mech/EE/civil) + software
- Community ground truth: the r/EngineeringResumes wiki (mirrored at
  [github.com/r-engineeringresumes/subreddit-wiki](https://github.com/r-engineeringresumes/subreddit-wiki),
  with [LaTeX templates](https://github.com/r-engineeringresumes/resume-templates)) —
  single column, no photo, quantified bullets in STAR/XYZ form, one page for
  students ([novoresume engineering guide](https://novoresume.com/career-blog/engineering-resume)).
- Discipline splits worth encoding as role packs: software (projects+GitHub —
  shipped as `role/swe-intern`), mechanical/civil (design projects, CAD/FEA
  toolchain, co-ops, FE/EIT exam status where relevant), electrical
  (projects with hardware artifacts, tapeouts/PCBs, lab skills).
- Action for A-boards: mine the wiki mirror for rules when building
  `role/mech-engineer-intern`, `role/ee-intern`.

### 2.5 Healthcare / Nursing (new grad)
- Section order inverts tech norms: Education → **Clinical Rotations** →
  Licensure & Certifications near the top
  ([Nursegrid new-grad template](https://nursegrid.com/blog/the-ultimate-new-grad-nursing-resume-template-with-examples/), [BluePipes guide](https://blog.bluepipes.com/how-to-write-new-grad-nursing-resume/)).
- Omitting clinical rotations is the classic new-grad mistake; rotations list
  facility, department, hours, key skills ([Indeed guide](https://www.indeed.com/career-advice/resumes-cover-letters/clinical-rotation-resume)).
- Certifications block: full name, issuing body, expiry, license number
  (RN, BLS, ACLS) ([Nurse.com FAQs](https://www.nurse.com/blog/resume-faqs-nursing-students/)).
- Schema impact: needs `certificates[]` prominence + a `clinicalRotations`
  concept — fits `projects[]` semantically but deserves an extension field
  when we build `role/nursing-newgrad` (log ADR then).

### 2.6 Research / Academia / Data Science
- CV ≠ resume: CVs unlimited length, full publication list in citation style,
  teaching+research detail; resumes 1–2 pages, 3–5 selected publications
  ([Cornell Grad School](https://gradschool.cornell.edu/career-and-professional-development/pathways-to-success/prepare-for-your-career/take-action/resumes-and-cvs/), [MIT CAPD](https://capd.mit.edu/resources/cvs/), [Princeton guide](https://careerdevelopment.princeton.edu/sites/g/files/toruqf1041/files/media/cv_vs._resume_guide_1.pdf)).
- Length reflects career stage — a padded 15-page PhD-student CV reads badly
  ([Wordvice](https://blog.wordvice.com/academic-cv-examples-format/)).
- DS/ML industry roles want the *resume* conventions + projects with data
  scale/metrics; research-track roles (labs, PhD applications) want the CV.
  → `role/research-assistant` (CV-style: page rules inverted, publications
  section expected) vs `role/data-analyst` (resume-style).
- Schema impact: `publications[]` (JSON Resume already has it — add to our
  zod schema when building these packs).

## 3. Pack roadmap implied (priority order for contributors)

1. `industry/finance` + `role/ib-analyst` (strong, checkable, well-sourced rules)
2. `role/mech-engineer-intern`, `role/ee-intern` (wiki mirror as source)
3. `industry/consulting` + `role/consulting-analyst`
4. `role/mba-admissions`, `role/mba-associate` + `industry/business`
5. `role/nursing-newgrad` + `industry/healthcare` (needs schema extension)
6. `role/research-assistant` (needs publications[] + CV-mode length rules)

Each pack PR must: cite this doc's sources (or better ones), ship pos/neg
fixtures per rule, and add ≥1 golden resume × expectations to the eval set.
