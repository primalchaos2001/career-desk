import { highestLevel, LEVEL_NAMES, levelOf } from "./vendor/seniority";
import { groupsOf, extractSkills as skillsIn } from "./vocab";

/**
 * Smart matcher: deterministic, explainable job-to-candidate scoring. No LLM.
 *
 *  - Skills (35): which skills the posting asks for, split into required and
 *    nice-to-have, matched against the CV. Related skills (same rule-pack group,
 *    e.g. Questa vs Xcelium) get half credit.
 *  - Text similarity (15): TF-IDF cosine between CV and posting, with IDF from
 *    the other postings in the workspace so boilerplate words count for little.
 *  - Title (20), location (10), campaign keywords (5), salary (10) and
 *    experience (5) from the campaign preferences.
 *
 * Only signals that have data count towards the total, so a job with no salary
 * is not punished for it. Hard problems (missing mandatory credential, excluded
 * term, a large experience gap) make the job ineligible.
 */

export interface MatchInput {
  cv: string;
  candidateSkills: string;
  candidateYears: string;
  candidateCredentials: string;
  candidateLanguages: string;
  titles: string;
  locations: string;
  keywords: string;
  exclusions: string;
  minLpa: string;
  job: {
    company: string;
    title: string;
    location: string;
    description: string;
    salaryLpa: string;
    minExperience: string;
    requiredCredentials: string;
    requiredLanguages: string;
  };
  /** Other postings, used for IDF (see buildCorpus). Optional. */
  corpus?: Corpus;
}

export interface SkillMatch {
  /** Required skills the CV shows. */
  matched: string[];
  /** Asked-for skills where the CV shows a related one (half credit). */
  related: string[];
  /** Required skills the CV does not show, most important first. */
  missing: string[];
  /** Nice-to-have skills the CV does not show. */
  missingOptional: string[];
}

export interface MatchResult {
  score: number;
  reasons: string[];
  warnings: string[];
  eligible: boolean;
  /** 0-100 per signal that had data. */
  breakdown: Record<string, number>;
  skills: SkillMatch;
  /** Missing skills worth adding to the CV if the candidate really has them. */
  keywordsToAdd: string[];
  seniority: { job: string; candidate: string };
  yearsRequired: number | null;
}

const WEIGHTS = {
  skills: 35,
  title: 20,
  similarity: 15,
  location: 10,
  salary: 10,
  keywords: 5,
  experience: 5,
} as const;

export const list = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
const lower = (s: string) => s.toLowerCase();
const contains = (hay: string, needle: string) => lower(hay).includes(lower(needle));

// ── Text similarity ─────────────────────────────────────────────────────────

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being below
  between both but by can could did do does doing down during each etc few for from further had has
  have having he her here hers him his how i if in into is it its itself just me more most my no nor
  not now of off on once only or other our ours out over own same she should so some such than that
  the their theirs them then there these they this those through to too under until up very was we
  were what when where which while who whom why will with would you your yours role job work team
  company candidate candidates experience years year strong good excellent ability skills skill
  required requirements responsibilities preferred plus including within across using use well new
  looking opportunity join apply position based must etc per`.split(/\s+/),
);

export function terms(text: string): string[] {
  return (lower(text).match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? [])
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

function tf(tokens: string[]) {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Document frequencies of the saved postings, built once per workspace. */
export interface Corpus {
  size: number;
  df: Map<string, number>;
}

export function buildCorpus(texts: readonly string[]): Corpus {
  const df = new Map<string, number>();
  for (const t of texts)
    for (const term of new Set(terms(t))) df.set(term, (df.get(term) ?? 0) + 1);
  return { size: texts.length, df };
}

/** TF-IDF cosine similarity in [0, 1]. */
export function similarity(a: string, b: string, corpus?: Corpus): number {
  const ta = tf(terms(a));
  const tb = tf(terms(b));
  if (!ta.size || !tb.size) return 0;
  const n = 2 + (corpus?.size ?? 0);
  const idf = (t: string) => {
    const df = (ta.has(t) ? 1 : 0) + (tb.has(t) ? 1 : 0) + (corpus?.df.get(t) ?? 0);
    return Math.log((n + 1) / (df + 1)) + 1;
  };
  const weight = (m: Map<string, number>) =>
    new Map([...m].map(([t, c]) => [t, (1 + Math.log(c)) * idf(t)] as const));
  const wa = weight(ta);
  const wb = weight(tb);
  let dot = 0;
  for (const [t, v] of wa) dot += v * (wb.get(t) ?? 0);
  const norm = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((sum, v) => sum + v * v, 0));
  return dot / (norm(wa) * norm(wb) || 1);
}

// ── Posting structure ───────────────────────────────────────────────────────

const OPTIONAL_HINT =
  /\b(nice[- ]to[- ]have|good[- ]to[- ]have|preferred|bonus|desirable|a plus|is a plus|advantage|optional|familiarity)\b/i;
const REQUIRED_HEADING =
  /\b(requirements?|required|must[- ]have|qualifications?|what you(?:'ll)? need|you (?:have|bring)|skills)\b/i;

/**
 * Skills the posting asks for, each with importance 1 (required) or 0.5 (nice
 * to have). Section headings switch the mode; an inline "preferred" or "a plus"
 * marks just that line. A skill named anywhere as required stays required.
 */
export function postingSkills(
  title: string,
  description: string,
): Map<string, { name: string; weight: number }> {
  const out = new Map<string, { name: string; weight: number }>();
  const put = (k: string, name: string, weight: number) => {
    const prev = out.get(k);
    if (!prev || prev.weight < weight) out.set(k, { name, weight });
  };
  for (const [k, n] of skillsIn(title)) put(k, n, 1);
  let section = 1;
  for (const line of description.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isHeading = trimmed.length < 60 && !/[.]$/.test(trimmed);
    if (isHeading && OPTIONAL_HINT.test(trimmed)) section = 0.5;
    else if (isHeading && REQUIRED_HEADING.test(trimmed)) section = 1;
    const weight = OPTIONAL_HINT.test(trimmed) ? 0.5 : section;
    for (const [k, n] of skillsIn(trimmed)) put(k, n, weight);
  }
  return out;
}

/** Minimum years of experience a posting states, e.g. "3+ years", "2-4 yrs". */
export function yearsRequired(raw: string): number | null {
  // Board descriptions arrive as Markdown ("**Experience:** 4 to 10 Years").
  const text = raw.replace(/[*_`]/g, "");
  let best: number | null = null;
  const labelled = text.match(
    /experience\s*(?:required)?\s*[:-]\s*(\d{1,2})\s*(?:\+|-|–|to|years?|yrs?)/i,
  );
  if (labelled) best = Number(labelled[1]);
  const re =
    // "3+ years of experience", "2-4 yrs exp", or a bare "7-12 Yrs" closing a
    // title segment ("DV Engineer, 7-12 Yrs, Bangalore").
    /(\d{1,2})(?:\.\d)?\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:years?|yrs?)(?:'s)?(?:(?:\s+of)?(?:\s+\w+){0,3}?\s+(?:experience|exp\b)|(?=\s*(?:[,)|\]]|$)))/gim;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n <= 30 && (best === null || n < best)) best = n;
  }
  const min = text.match(/(?:minimum|min\.?|at least)\s+(?:of\s+)?(\d{1,2})\s*(?:years?|yrs?)/i);
  if (min) {
    const n = Number(min[1]);
    if (best === null || n < best) best = n;
  }
  return best;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function titleScore(targets: string[], title: string): number {
  if (!targets.length) return -1;
  const jobWords = new Set(terms(title));
  let best = 0;
  for (const t of targets) {
    if (contains(title, t)) return 1;
    const words = terms(t);
    if (!words.length) continue;
    const hit = words.filter((w) => jobWords.has(w)).length / words.length;
    best = Math.max(best, hit);
  }
  return best;
}

export function scoreMatch(input: MatchInput): MatchResult {
  const { job } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const breakdown: Record<string, number> = {};
  let got = 0;
  let total = 0;
  const signal = (name: keyof typeof WEIGHTS, value: number) => {
    if (value < 0) return;
    const v = Math.max(0, Math.min(1, value));
    breakdown[name] = Math.round(v * 100);
    got += v * WEIGHTS[name];
    total += WEIGHTS[name];
  };
  const posting = `${job.title}\n${job.description}`;
  const cvText = `${input.cv}\n${input.candidateSkills}`;

  // Skills
  const wanted = postingSkills(job.title, `${job.description}\n${job.requiredCredentials}`);
  const have = skillsIn(cvText);
  const haveGroups = new Set([...have.keys()].flatMap((k) => [...groupsOf(k)]));
  const skills: SkillMatch = { matched: [], related: [], missing: [], missingOptional: [] };
  let skillGot = 0;
  let skillTotal = 0;
  for (const [k, { name, weight }] of wanted) {
    skillTotal += weight;
    if (have.has(k)) {
      skillGot += weight;
      skills.matched.push(name);
    } else if ([...groupsOf(k)].some((g) => haveGroups.has(g))) {
      skillGot += weight / 2;
      skills.related.push(name);
    } else if (weight >= 1) skills.missing.push(name);
    else skills.missingOptional.push(name);
  }
  if (skillTotal) {
    const v = skillGot / skillTotal;
    signal("skills", v);
    if (skills.matched.length)
      reasons.push(
        `Skills you have: ${skills.matched.slice(0, 6).join(", ")}${skills.matched.length > 6 ? "…" : ""}`,
      );
    if (skills.missing.length)
      warnings.push(`Required skills not on your CV: ${skills.missing.slice(0, 6).join(", ")}`);
    if (!skills.matched.length && !skills.related.length)
      warnings.push("No explicit profile skill match found");
  } else if (!job.description.trim()) {
    warnings.push("Add the full job description for a useful match");
  }

  // Text similarity
  if (job.description.trim() && input.cv.trim()) {
    const sim = similarity(cvText, posting, input.corpus);
    // Raw cosines between a CV and a posting rarely pass 0.4; scale so a
    // strong overlap reads as a high score.
    signal("similarity", sim / 0.35);
    if (sim >= 0.25) reasons.push("Your CV reads close to this posting");
  }

  // Title
  const title = titleScore(list(input.titles), job.title);
  signal("title", title);
  if (title === 1) reasons.push("Target role matches");
  else if (title > 0) reasons.push("Job title partly matches your target roles");
  else if (title === 0) warnings.push("Job title differs from your target roles");

  // Location
  const locations = list(input.locations);
  if (locations.length) {
    const ok = locations.some((l) => contains(job.location, l)) || /remote/i.test(job.location);
    signal("location", ok ? 1 : 0);
    if (ok) reasons.push("Location matches your search");
    else warnings.push("Location needs review");
  }

  // Campaign keywords
  const keywords = list(input.keywords);
  if (keywords.length) {
    const hits = keywords.filter((k) => contains(posting, k));
    signal("keywords", hits.length / keywords.length);
    if (hits.length) reasons.push(`Desired keywords found: ${hits.join(", ")}`);
    else warnings.push("Desired keywords not found");
  }

  // Salary
  if (input.minLpa) {
    if (job.salaryLpa) {
      const ok = Number(job.salaryLpa) >= Number(input.minLpa);
      signal("salary", ok ? 1 : Number(job.salaryLpa) / Number(input.minLpa));
      if (ok) reasons.push("Listed annual CTC meets your minimum");
      else warnings.push("Listed CTC is below your minimum");
    } else warnings.push("Salary not listed; confirm compensation");
  }

  // Experience and seniority
  const years = job.minExperience
    ? Number(job.minExperience)
    : yearsRequired(`${job.title}\n${job.description}`);
  const mine = input.candidateYears ? Number(input.candidateYears) : null;
  let eligible = true;
  if (years !== null && years > 0) {
    if (mine === null) {
      warnings.push(`Experience needs verification: ${years}+ years required`);
      eligible = false;
    } else {
      const gap = years - mine;
      signal("experience", gap <= 0 ? 1 : gap <= 1 ? 0.6 : 0);
      if (gap <= 0) reasons.push(`Experience fits (${years}+ years asked)`);
      else {
        warnings.push(`Experience needs verification: ${years}+ years required, you have ${mine}`);
        if (gap > 2) eligible = false;
      }
    }
  }
  const jobLevel = levelOf(job.title);
  const myLevel = levelOf(input.titles);
  if (jobLevel >= 0 && myLevel >= 0 && jobLevel !== myLevel)
    warnings.push(
      `Seniority differs: posting is ${LEVEL_NAMES[jobLevel]}, you target ${LEVEL_NAMES[myLevel]}`,
    );
  // A senior or staff title is out of reach for someone with little experience,
  // even when the posting states no years.
  const topLevel = highestLevel(job.title);
  if (mine !== null && topLevel >= 3 && mine < (topLevel === 3 ? 2 : 5)) {
    warnings.push(`${LEVEL_NAMES[topLevel]} role; you have ${mine} years of experience`);
    eligible = false;
  }

  // Hard filters
  if (
    list(input.exclusions).some((v) =>
      contains(`${job.company} ${job.title} ${job.description}`, v),
    )
  ) {
    warnings.push("Contains an excluded term");
    eligible = false;
  }
  for (const credential of list(job.requiredCredentials))
    if (!list(input.candidateCredentials).some((v) => lower(v) === lower(credential))) {
      warnings.push(`Verify mandatory credential: ${credential}`);
      eligible = false;
    }
  for (const lang of list(job.requiredLanguages))
    if (!list(input.candidateLanguages).some((v) => lower(v) === lower(lang))) {
      warnings.push(`Verify required language: ${lang}`);
      eligible = false;
    }

  return {
    score: total ? Math.round((got / total) * 100) : 0,
    reasons,
    warnings,
    eligible,
    breakdown,
    skills,
    keywordsToAdd: [...skills.missing, ...skills.related, ...skills.missingOptional].slice(0, 10),
    seniority: {
      job: LEVEL_NAMES[jobLevel] ?? "",
      candidate: LEVEL_NAMES[myLevel] ?? "",
    },
    yearsRequired: years !== null && years > 0 ? years : null,
  };
}
