import { getPack, packIds } from "@tailorats/rules/bundled";
import { canonicalize, extractSkills as extractTechSkills } from "./vendor/skillExtract";

/**
 * Skill vocabulary for matching. Two sources, both deterministic:
 *  1. career-ops' tested software/data/marketing/certification vocabulary
 *     (vendor/skillExtract.ts), with its exact-alias canonical names.
 *  2. Career Desk's own rule packs (DV engineer, consulting, finance, product,
 *     mechanical...), so non-software campaigns are not invisible.
 *
 * Rule-pack groups are kept as *groups*, not aliases: knowing Questa does not
 * mean knowing Xcelium, but it is related, so the matcher gives partial credit.
 */

/** Pack aliases that are ordinary words, not skills; matching them adds noise. */
const NOT_SKILLS = new Set(
  [
    "r",
    "api",
    "layout",
    "testing",
    "simulation",
    "growth",
    "coverage",
    "assertions",
    "presentation",
    "slides",
    "deck",
    "reporting",
    "modeling",
    "metrics",
    "database",
    "databases",
    "query",
    "queries",
    "querying",
    "operations",
    "coordination",
    "transactions",
    "frameworks",
    "best practices",
    "data-driven",
    "client-facing",
    "visualization",
    "retention",
    "conversion",
    "workshop",
    "fabrication",
    "valuation",
    "compliance",
    "hedging",
    "var",
    "bmc",
    "quant",
    "led",
    // Group labels and soft or ambiguous terms from the packs: "regression"
    // means test runs in verification and statistics elsewhere.
    "protocols",
    "eda tools",
    "lab equipment",
    "cloud",
    "regression",
    "problem solving",
    "cross-functional",
    "data analysis",
    "structured analysis",
    "coordination",
    "client relations",
    "statistical computing",
    "operations",
  ].map((s) => s.toLowerCase()),
);

/** Packs whose keywords describe writing style rather than skills. */
const SKIP_PACKS = new Set(["role/mba-applicant"]);

/** Hardware, embedded and business skills neither source lists yet. */
const EXTRA_SKILLS = [
  "ASIC",
  "FPGA",
  "SoC",
  "Perl",
  "Tcl",
  "Embedded C",
  "Linux",
  "Shell scripting",
  "Formal verification",
  "JasperGold",
  "cocotb",
  "PCIe",
  "DDR",
  "USB",
  "Ethernet",
  "CDC",
  "UPF",
  "Low power",
  "Lint",
  "SpyGlass",
  "Innovus",
  "PrimeTime",
  "Genus",
  "Physical design",
  "Place and route",
  "DSP",
  "Fixed-point",
  "JIRA",
  "Confluence",
  "Figma",
  "Product strategy",
  "Go-to-market",
  "Business analysis",
  "Financial modelling",
  "Stakeholder management",
];

interface Term {
  display: string;
  pattern: RegExp;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function termPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  // Short all-caps acronyms (STA, SPI, CDC) are case-sensitive so "sta" or
  // "spi" inside ordinary prose never counts. Everything else ignores case.
  const caseSensitive = /^[A-Z0-9&/]{2,5}$/.test(token);
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, caseSensitive ? "" : "i");
}

let built: { terms: Term[]; groups: Map<string, Set<string>> } | undefined;

function build() {
  if (built) return built;
  const displays = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  const add = (raw: string, group?: string) => {
    const display = canonicalize(raw.trim());
    const k = key(display);
    if (!k || NOT_SKILLS.has(k)) return;
    if (!displays.has(k)) displays.set(k, display);
    if (group) {
      const set = groups.get(k) ?? new Set<string>();
      set.add(group);
      groups.set(k, set);
    }
  };
  for (const id of packIds()) {
    if (SKIP_PACKS.has(id)) continue;
    for (const g of getPack(id).searchKeywords ?? []) {
      const group = `${id}:${g.term}`;
      for (const t of [g.term, ...(g.aliases ?? [])]) add(t, group);
    }
  }
  for (const s of EXTRA_SKILLS) add(s);
  built = {
    terms: [...displays.values()].map((display) => ({ display, pattern: termPattern(display) })),
    groups,
  };
  return built;
}

/** Canonical skill names found in the text, keyed by lower case. */
export function extractSkills(text: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!text) return found;
  for (const s of extractTechSkills(text)) found.set(key(s), s);
  for (const t of build().terms) if (t.pattern.test(text)) found.set(key(t.display), t.display);
  return found;
}

/** Rule-pack groups a skill belongs to (empty for career-ops-only skills). */
export function groupsOf(skillKey: string): ReadonlySet<string> {
  return build().groups.get(skillKey) ?? new Set();
}
