// Copied from career-ops (https://github.com/career-ops-hq/career-ops),
// jd-similarity.mjs at commit a8ea6d16d8ad38817b1fc333d717b8ada4b9a227.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.
// See third_party/career-ops/LICENSE. Changes: TypeScript types, the CLI and
// the CV-reuse recommendation removed; `levelOf` and `LEVEL_NAMES` exported;
// "sr" added as a senior level word.

const LEVELS = [
  ["intern", "实习", "实习生", "应届"],
  ["junior", "初级"],
  ["mid", "中级"],
  ["senior", "sr", "高级", "资深"],
  ["staff", "principal", "lead", "负责人"],
];

/** Display names for the LEVELS indices returned by `levelOf`. */
export const LEVEL_NAMES = ["intern", "junior", "mid-level", "senior", "staff/lead"];

/**
 * Level words that are also ordinary English, mapped to the words that follow
 * them in their NON-seniority sense. JD boilerplate is full of these: "Principal
 * responsibilities" means "main duties", "mid-market" is a customer segment, and
 * "lead" is usually a verb. Matching them as job levels made the gate fire
 * on postings of identical seniority.
 */
const NON_LEVEL_FOLLOWERS: Record<string, string[]> = {
  principal: [
    "responsibilities",
    "responsibility",
    "duties",
    "accountabilities",
    "objectives",
    "purpose",
    "tasks",
    "activities",
  ],
  lead: [
    "to",
    "the",
    "a",
    "an",
    "our",
    "and",
    "or",
    "by",
    "on",
    "in",
    "for",
    "with",
    "from",
    "mentoring",
    "projects",
  ],
  mid: ["market", "size", "sized", "cap", "tier", "funnel", "term", "sized-company"],
};

function readsAsLevel(word: string, normalized: string, index: number): boolean {
  const followers = NON_LEVEL_FOLLOWERS[word];
  if (!followers) return true;
  const after = normalized.slice(index + word.length).match(/^[^a-z0-9]*([a-z0-9-]+)/);
  return !after?.[1] || !followers.includes(after[1]);
}

/** Every distinct seniority level named in the text, as LEVELS indices. */
function levelsIn(text: string): Set<number> {
  const normalized = String(text ?? "").toLowerCase();
  const found = new Set<number>();
  LEVELS.forEach((words, level) => {
    for (const word of words) {
      if (/^[\p{Script=Han}]+$/u.test(word)) {
        if (normalized.includes(word)) {
          found.add(level);
          break;
        }
        continue;
      }
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "gi");
      let match: RegExpExecArray | null = pattern.exec(normalized);
      while (match !== null) {
        if (readsAsLevel(word, normalized, match.index + match[0].length - word.length)) {
          found.add(level);
          break;
        }
        match = pattern.exec(normalized);
      }
      if (found.has(level)) break;
    }
  });
  return found;
}

/**
 * The seniority level of a document, or -1 when it has no single unambiguous
 * one. Naming several levels counts as ambiguous, not as the lowest one.
 */
/** The highest level a title names ("Sr Lead" → staff/lead), or -1. Career Desk addition. */
export function highestLevel(text: string): number {
  return Math.max(-1, ...levelsIn(text));
}

export function levelOf(text: string): number {
  const levels = levelsIn(text);
  return levels.size === 1 ? ([...levels][0] ?? -1) : -1;
}
