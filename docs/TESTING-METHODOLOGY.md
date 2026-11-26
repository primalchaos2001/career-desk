# Testing Methodology & Scorer Calibration

This document outlines the testing methodology used to calibrate and verify the Context-Aware Resume Improvement Scorer (D-039 scoring engine). 

## 1. Overview of Testing Layers

Our testing architecture consists of three distinct validation layers:

1. **Unit Tests (Vitest)**: Fast, deterministic tests that verify core functions, including PDF/TeX text extraction, section splitting, individual rule validation, and LLM provider interfaces.
2. **Golden-Set Evaluations (`pnpm eval`)**: Exact-match assertion harness comparing the evaluated rule findings for 34 golden resume context pairs (including varying regions and roles) to prevent regressions in the deterministic rule packs.
3. **Cross-Context Scoring Matrix (`matrix.ts`)**: A systemic calibration matrix that evaluates all resumes (including golden profiles and local candidate resumes) across all 16 target contexts. This verifies that:
   - Resumes score highly in their native/target roles/regions.
   - Resumes score poorly when evaluated against irrelevant contexts (proving alignment differentiation).

---

## 2. Cross-Context Matrix Grading Logic

To calibrate the scorer, we grade the overall score generated for each resume-context pair using the following rules:

### A. Native/Target Role and Region (Same Domain)
We evaluate whether a strong resume gets high scores, and a weak resume gets low scores in its native context:
- **Strong Resume** (e.g. `mech-engineer-clean` under `us-mech`):
  - Expected: Score $\ge 70$ (Good)
  - Grade: **+5 points** if passing, **0 points** if failed/weak.
- **Weak Resume** (e.g. `mech-engineer-bad` under `us-mech`):
  - Expected: Score $< 70$ (Weak)
  - Grade: **+5 points** if passing, **0 points** if failed/strong.

### B. Inter-Domain or Irrelevant Role/Region (Cross-Domain)
We evaluate whether the scorer correctly penalizes resumes when matched against inappropriate contexts (e.g., an engineering resume evaluated against an MBA or Finance target):
- **Expected**: Score $< 65$ (Poor)
- **Grade**: **+5 points** if correctly penalized, **-5 points** if it gets an unexpectedly high score (indicating a lack of context sensitivity).

---

## 3. Findings & Recommendations

The total grade across all combinations is tracked as a cumulative score (e.g., in `matrix_output.md`). 
A high cumulative grade proves that:
1. Role-specific findability rules are firing correctly.
2. Region-specific layouts (e.g. photo/personal details constraints) are properly validated.
3. Writing quality checks (quantification density, weak verbs) are properly penalizing passive/weak profiles.
