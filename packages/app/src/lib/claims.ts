import type { Profile } from "./workspace";

/**
 * Flags statements in a letter or email that the user's own profile and CV do
 * not back up. It checks support, not truth: a flagged claim may be correct but
 * missing from the profile, and an unflagged one may still be wrong.
 */

export type ClaimWarning = {
  kind: "placeholder" | "experience" | "degree" | "skill" | "employer" | "figure";
  /** The text found in the draft. */
  found: string;
  message: string;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
};

// Degree spellings, grouped so "B.Tech" and "BTech" count as the same degree.
const DEGREES: [label: string, pattern: RegExp][] = [
  ["B.Tech", /\bB\.?\s?Tech\b/i],
  ["M.Tech", /\bM\.?\s?Tech\b/i],
  ["B.E.", /\bB\.E\.(?=\s|,|$)|\bBachelor of Engineering\b/i],
  ["M.E.", /\bM\.E\.(?=\s|,|$)|\bMaster of Engineering\b/i],
  ["B.Sc", /\bB\.?\s?Sc\b|\bBachelor of Science\b/i],
  ["M.Sc", /\bM\.?\s?Sc\b|\bMaster of Science\b/i],
  ["M.S.", /\bM\.S\.(?=\s|,|$)/i],
  ["MBA", /\bMBA\b|\bMaster of Business Administration\b/i],
  ["PhD", /\bPh\.?\s?D\b|\bdoctorate\b/i],
  ["BCA", /\bBCA\b/],
  ["MCA", /\bMCA\b/],
  ["B.Com", /\bB\.?\s?Com\b/i],
  ["BBA", /\bBBA\b/],
  ["M.A.", /\bM\.A\.(?=\s|,|$)|\bMaster of Arts\b/i],
  ["B.A.", /\bB\.A\.(?=\s|,|$)|\bBachelor of Arts\b/i],
];

// Degree subjects that are easy to overstate (e.g. Biomedical vs Electronics).
const FIELDS = [
  "Electronics",
  "Electrical",
  "Computer Science",
  "Electronics and Communication",
  "Mechanical",
  "Biomedical",
  "Chemical",
  "Civil",
  "Physics",
  "Mathematics",
  "Psychology",
  "Information Technology",
  "VLSI Design",
  "Microelectronics",
];

// Named tools and technologies. Generic words ("verification", "design") are
// left out on purpose: they are too vague to check.
const SKILLS = [
  "SystemVerilog",
  "Verilog",
  "VHDL",
  "UVM",
  "OVM",
  "SVA",
  "C-DPI",
  "DPI-C",
  "SystemC",
  "Python",
  "Perl",
  "Tcl",
  "C++",
  "MATLAB",
  "Simulink",
  "Xcelium",
  "VCS",
  "Questa",
  "ModelSim",
  "SimVision",
  "Verdi",
  "JasperGold",
  "Design Compiler",
  "Genus",
  "Innovus",
  "ICC2",
  "PrimeTime",
  "Spyglass",
  "Conformal",
  "Calibre",
  "Virtuoso",
  "Vivado",
  "Quartus",
  "FPGA",
  "UPF",
  "CPF",
  "CDC",
  "RDC",
  "STA",
  "AXI",
  "AHB",
  "APB",
  "PCIe",
  "DDR",
  "USB",
  "Ethernet",
  "I2C",
  "I3C",
  "SPI",
  "UART",
  "RISC-V",
  "ARM Cortex",
  "Linux",
  "Git",
  "Jenkins",
  "Docker",
  "Kubernetes",
  "AWS",
  "Azure",
  "GCP",
  "Java",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "SQL",
  "Excel",
  "Power BI",
  "Tableau",
  "Salesforce",
  "SAP",
  "TensorFlow",
  "PyTorch",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (s: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])`, "i");

/** Everything the user has stated about themselves. */
export function profileCorpus(p: Profile): string {
  return [
    p.name,
    p.headline,
    p.summary,
    p.skills,
    p.qualifications,
    p.credentials,
    p.languages,
    p.portfolio,
    p.resumeText,
    p.resumeDoc ? JSON.stringify(p.resumeDoc) : "",
  ].join("\n");
}

export function checkClaims(
  profile: Profile,
  text: string,
  context: { company?: string } = {},
): ClaimWarning[] {
  const corpus = profileCorpus(profile);
  const has = (s: string) => wordRe(s).test(corpus);
  const out: ClaimWarning[] = [];
  const seen = new Set<string>();
  const add = (w: ClaimWarning) => {
    const key = `${w.kind}:${w.found.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  };

  for (const m of text.matchAll(/\[(?:Add|add) [^\]]{1,60}\]|\{\{\s*\w+\s*\}\}/g))
    add({ kind: "placeholder", found: m[0], message: `Placeholder left in the text: ${m[0]}` });

  // "2 years", "2+ years", "1.5 yrs", "two years" of experience.
  const stated = profile.experienceYears ? Number(profile.experienceYears) : undefined;
  const yearsRe =
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s*\+?\s*(?:years?|yrs?)\b(?![-\s]old)/gi;
  for (const m of text.matchAll(yearsRe)) {
    const raw = (m[1] ?? "").toLowerCase();
    const n = NUMBER_WORDS[raw] ?? Number(raw);
    const near = text.slice(m.index ?? 0, (m.index ?? 0) + 60).toLowerCase();
    if (
      !/experience|exp\b|working|industry|professional|hands-on/.test(near) &&
      !near.includes("+")
    )
      continue; // e.g. "a four-year degree" or "for two years at university"
    if (stated === undefined)
      add({
        kind: "experience",
        found: m[0],
        message: `Claims ${m[0]} of experience, but your profile has no experience figure`,
      });
    else if (n > stated + 0.25)
      add({
        kind: "experience",
        found: m[0],
        message: `Claims ${m[0]} of experience; your profile says ${stated}`,
      });
  }

  for (const [label, re] of DEGREES) {
    const m = text.match(re);
    if (m && !re.test(corpus))
      add({
        kind: "degree",
        found: m[0],
        message: `Mentions a ${label} not in your profile or CV`,
      });
  }
  for (const field of FIELDS) {
    const re = new RegExp(`\\b(?:in|of)\\s+${escapeRe(field)}\\b`, "i");
    const m = text.match(re);
    if (m && !has(field))
      add({
        kind: "degree",
        found: field,
        message: `Mentions ${field} as a subject; your profile doesn't`,
      });
  }

  for (const skill of SKILLS)
    if (wordRe(skill).test(text) && !has(skill))
      add({
        kind: "skill",
        found: skill,
        message: `Mentions ${skill}, which isn't in your profile or CV`,
      });

  // "worked at X", "intern at X", "engineer at X Labs".
  const employerRe =
    /\b(?:worked|working|interned|employed|experience|role|position|engineer|intern|developer|analyst|consultant)\s+(?:at|with)\s+([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3})/g;
  for (const m of text.matchAll(employerRe)) {
    const name = (m[1] ?? "").replace(/[.,]$/, "");
    if (!name || (context.company && wordRe(name).test(context.company))) continue;
    if (!has(name))
      add({
        kind: "employer",
        found: name,
        message: `Mentions work at ${name}, which isn't in your profile or CV`,
      });
  }

  // Specific results: "30%", "2x", "10,000 users". These should come from the CV.
  for (const m of text.matchAll(/\b\d[\d,.]*\s?(?:%|x\b|X\b)|\b\d{1,3}(?:,\d{3})+\b/g)) {
    const found = m[0].trim();
    if (!corpus.includes(found))
      add({
        kind: "figure",
        found,
        message: `Uses the figure ${found}, which isn't in your profile or CV`,
      });
  }
  return out;
}

export const hasPlaceholders = (warnings: ClaimWarning[]) =>
  warnings.some((w) => w.kind === "placeholder");
