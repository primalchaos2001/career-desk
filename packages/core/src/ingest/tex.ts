import type * as Ast from "@unified-latex/unified-latex-types";
import { attachMacroArgs } from "@unified-latex/unified-latex-util-arguments";
import { parse } from "@unified-latex/unified-latex-util-parse";
import type {
  Basics,
  Education,
  Profile,
  Project,
  ResumeDoc,
  Skill,
  TexSourceRange,
  Work,
} from "../resume.js";
import { ResumeDoc as ResumeDocSchema } from "../resume.js";
import { type CanonicalSection, matchHeading } from "./sections.js";
import {
  detectDateOfBirth,
  detectDeclarationLine,
  detectMaritalStatus,
  detectNationality,
  detectSpellingVariant,
} from "./signals.js";

/**
 * .tex ingest (O-03, ADRs D-023 + D-041): deterministic parser → ResumeDoc +
 * meta.texSourceMap, no LLM call (ARCHITECTURE §3). Built for Jake's template,
 * hardened (D-041) for real non-Jake's layouts.
 *
 * Recognized structure:
 *  - contact: \begin{center}/tabularx preamble; name = first \textbf or the
 *    group after a size switch (\Huge{Name}); email/urls/phone from \href AND
 *    bare text; placeholder urls (<...>) skipped. Preamble only — later
 *    unrecognized-heading blocks never clobber it.
 *  - \section{...} headings via the O-01 lexicon (sections.ts).
 *  - entries: \resumeSubheading / \resumeProjectHeading / \resumeItem, custom
 *    per-entry environments (joblong/projectentry: leading groups = args,
 *    \item children = bullets), and a standalone \textbf heading + itemize.
 *    Work fields are mapped by anchoring on the date argument's position.
 *  - skills: \textbf{Group}{: a, b} itemize, else tabular/tabularx rows.
 *  - education: \resumeSubheading, else tabularx rows (… at \textbf{Inst} …).
 * Unsupported constructs degrade gracefully: unknown macros flatten to visible
 * text, inline math is dropped, unrecognized sections are skipped.
 *
 * texSourceMap semantics: 1-indexed inclusive ranges; a section spans its
 * \section line through the line before the next \section (or \end{document}).
 */

type Node = Ast.Node;

/** Control symbols (\&, \%, …) that render as a literal character, not a command. */
const LITERAL_MACROS: Record<string, string> = {
  "&": "&",
  "%": "%",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  "~": "~",
  "^": "^",
};

/** Spacing macros (\,, \quad, \ , …) that render as whitespace. */
const SPACE_MACROS = new Set([
  " ",
  ",",
  ";",
  ":",
  "!",
  "quad",
  "qquad",
  "enspace",
  "thinspace",
  "hfill",
]);

/** Flatten AST nodes to visible text; hrefs contribute their display text. */
function flattenText(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "string":
        out += node.content;
        break;
      case "whitespace":
      case "parbreak":
        out += " ";
        break;
      case "group":
        out += flattenText(node.content);
        break;
      case "environment":
      case "mathenv":
      case "verbatim":
        out += flattenText(node.content as Node[]);
        break;
      case "inlinemath":
        out += flattenText(node.content as Node[]);
        break;
      case "macro": {
        const args = node.args ?? [];
        const name = node.content;
        if (name === "href") {
          const display = args[args.length - 1];
          if (display) out += flattenText(display.content as Node[]);
        } else if (name === "\\") {
          out += "\n";
        } else if (name in LITERAL_MACROS) {
          out += LITERAL_MACROS[name];
        } else if (SPACE_MACROS.has(name)) {
          out += " ";
        } else if (args.length > 0) {
          for (const arg of args) out += flattenText(arg.content as Node[]);
        }
        break;
      }
      default:
        break;
    }
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

/** Collect all \href{url}{text} pairs under the given nodes. */
function collectHrefs(nodes: Node[], into: { url: string; text: string }[]): void {
  for (const node of nodes) {
    if (node.type === "macro" && node.content === "href" && node.args?.length) {
      const [urlArg, textArg] = [node.args[node.args.length - 2], node.args[node.args.length - 1]];
      if (urlArg && textArg) {
        into.push({
          url: flattenText(urlArg.content as Node[]),
          text: flattenText(textArg.content as Node[]),
        });
      }
    } else if ("content" in node && Array.isArray(node.content)) {
      collectHrefs(node.content as Node[], into);
    } else if (node.type === "macro" && node.args) {
      for (const arg of node.args) collectHrefs(arg.content as Node[], into);
    }
  }
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** "Aug. 2022" → "2022-08"; "2022" → "2022"; anything else → null */
export function parseTexDate(raw: string): string | null {
  const text = raw.trim();
  const monthYear = text.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (monthYear?.[1] && monthYear[2]) {
    const month =
      MONTHS[monthYear[1].toLowerCase().slice(0, 4)] ??
      MONTHS[monthYear[1].toLowerCase().slice(0, 3)];
    return month ? `${monthYear[2]}-${month}` : monthYear[2];
  }
  if (/^\d{4}$/.test(text)) return text;
  return null;
}

/** "Aug. 2022 -- May 2026" | "Aug. 2024" | "Jun. 2025 -- Present" */
export function parseDateRange(raw: string): { startDate?: string; endDate?: string } {
  const parts = raw.split(/\s*(?:--|–|—)\s*/).map((p) => p.trim());
  const first = parts[0] ?? "";
  const second = parts[1];
  const start = parseTexDate(first);
  const result: { startDate?: string; endDate?: string } = {};
  if (start) result.startDate = start;
  if (second === undefined) {
    if (start) result.endDate = start; // single date: start = end
  } else if (!/present|current/i.test(second)) {
    const end = parseTexDate(second);
    if (end) result.endDate = end;
  }
  return result;
}

interface TexSection {
  name: CanonicalSection | null;
  startLine: number;
  endLine: number;
  nodes: Node[];
}

function macroArgs(node: Ast.Macro): Node[][] {
  return (node.args ?? []).map((a) => a.content as Node[]);
}

/**
 * Split the document environment's content into the contact preamble and
 * lexicon-recognized sections, computing source-map line ranges.
 */
function segment(docContent: Node[], docEndLine: number): TexSection[] {
  const sections: TexSection[] = [];
  let current: TexSection = { name: null, startLine: 1, endLine: docEndLine, nodes: [] };

  for (const node of docContent) {
    if (node.type === "macro" && node.content === "section") {
      const headingText = flattenText((node.args ?? []).flatMap((a) => a.content as Node[]));
      const line = node.position?.start.line ?? 0;
      current.endLine = line - 1;
      sections.push(current);
      current = {
        name: matchHeading(headingText),
        startLine: line,
        endLine: docEndLine,
        nodes: [],
      };
    } else {
      current.nodes.push(node);
    }
  }
  current.endLine = docEndLine - 1;
  sections.push(current);
  // preamble block starts at its first meaningful node, not line 1
  const preamble = sections[0];
  if (preamble) {
    const firstNode = preamble.nodes.find(
      (n) => n.position && n.type !== "whitespace" && n.type !== "parbreak",
    );
    if (firstNode?.position) preamble.startLine = firstNode.position.start.line;
  }
  return sections;
}

/** Size/style switches whose following group holds the display name (\Huge{Name}). */
const NAME_SIZE_MACROS = new Set([
  "Huge",
  "HUGE",
  "huge",
  "LARGE",
  "Large",
  "large",
  "scshape",
  "bfseries",
]);

function parseBasics(nodes: Node[]): Basics {
  // name = first \textbf content, else the group following a size switch (\Huge{Name})
  let name = "";
  const findName = (ns: Node[]): void => {
    for (let i = 0; i < ns.length; i++) {
      if (name) return;
      const n = ns[i];
      if (!n) continue;
      if (n.type === "macro" && n.content === "textbf" && n.args?.length) {
        name = flattenText(n.args.flatMap((a) => a.content as Node[]));
      } else if (n.type === "macro" && NAME_SIZE_MACROS.has(n.content)) {
        let j = i + 1;
        while (j < ns.length && (ns[j]?.type === "whitespace" || ns[j]?.type === "parbreak")) j++;
        const next = ns[j];
        if (next?.type === "group") {
          const text = flattenText(next.content);
          if (text) name = text;
        }
      } else if ("content" in n && Array.isArray(n.content)) {
        findName(n.content as Node[]);
      }
    }
  };
  findName(nodes);

  const hrefs: { url: string; text: string }[] = [];
  collectHrefs(nodes, hrefs);

  const basics: Basics = { name, profiles: [] };
  const profiles: Profile[] = [];
  const hasNetwork = (net: string): boolean => profiles.some((p) => p.network === net);
  const addUrl = (url: string): void => {
    if (/[<>]/.test(url)) return; // placeholder like https://github.com/<your-github>
    if (url.startsWith("mailto:")) {
      if (!basics.email) basics.email = url.slice("mailto:".length);
    } else if (/linkedin\.com/i.test(url)) {
      if (!hasNetwork("LinkedIn")) profiles.push({ network: "LinkedIn", url });
    } else if (/github\.com/i.test(url)) {
      if (!hasNetwork("GitHub")) profiles.push({ network: "GitHub", url });
    } else if (!basics.url) {
      basics.url = url;
    }
  };
  for (const { url } of hrefs) addUrl(url);

  // Plain-text contacts (templates that print URLs bare, without \href).
  const flat = flattenText(nodes);
  if (!basics.email) {
    const email = flat.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) basics.email = email[0];
  }
  for (const url of flat.match(/https?:\/\/[^\s|)]+/gi) ?? []) addUrl(url);
  // Phone: require a leading "+" country code so we never grab a year range.
  const phone = flat.match(/\+\d[\d\s()-]{7,}\d/);
  if (phone) basics.phone = phone[0].trim();

  basics.profiles = profiles;
  return basics;
}

/** "Bachelor of Science in Computer Science, GPA: 3.7/4.0" | "M.Tech., Biomedical Engineering CGPA: 8.73/10" */
function parseDegreeLine(text: string): Pick<Education, "studyType" | "area" | "gpa"> {
  const result: Pick<Education, "studyType" | "area" | "gpa"> = {};
  let rest = text;
  // C?GPA absorbs the leading "C" of CGPA so it isn't left dangling on the area.
  const gpaMatch = rest.match(/[,;]?\s*C?GPA\s*[:\s]?\s*([\d.]+)\s*\/\s*([\d.]+)/i);
  if (gpaMatch?.[1] && gpaMatch[2]) {
    result.gpa = { value: Number(gpaMatch[1]), scale: Number(gpaMatch[2]) };
    rest = rest.replace(gpaMatch[0], "").trim();
  }
  rest = rest
    .replace(/\(\s*\)/g, "")
    .replace(/[,;]\s*$/, "")
    .trim();
  const inSplit = rest.split(/\s+in\s+/);
  if (inSplit.length >= 2 && inSplit[0]) {
    result.studyType = inSplit[0].trim();
    result.area = inSplit.slice(1).join(" in ").trim();
  } else {
    // no " in " — split "M.Tech., Biomedical Engineering" on the first comma
    const comma = rest.match(/^([^,]+),\s*(.+)$/);
    if (comma?.[1] && comma[2]) {
      result.studyType = comma[1].trim();
      result.area = comma[2].trim();
    } else if (rest) {
      result.studyType = rest;
    }
  }
  return result;
}

/** Environment name as a plain string (custom envs may carry it as nodes). */
function envNameOf(n: Ast.Environment): string {
  return (typeof n.env === "string" ? n.env : flattenText(n.env as Node[])).replace(/\*$/, "");
}

/** List environments whose \item children are bullets. */
const LIST_ENVS = new Set(["itemize", "enumerate", "description"]);

/** Layout wrappers that never start a résumé entry (tables, centering, columns). */
const LAYOUT_ENVS = new Set([
  ...LIST_ENVS,
  "center",
  "flushleft",
  "flushright",
  "tabular",
  "tabularx",
  "supertabular",
  "longtable",
  "multicols",
  "minipage",
]);

/**
 * Bullets from a node list. Handles both shapes unified-latex produces:
 * inside a known list env each \item swallows its body into its last arg;
 * inside an unknown custom env the body trails as siblings until the next
 * \item. When there are no direct \items, recurse into nested list envs.
 */
function collectItemBullets(ns: Node[]): string[] {
  const isItem = (n: Node | undefined): boolean => n?.type === "macro" && n.content === "item";
  const bullets: string[] = [];
  if (ns.some(isItem)) {
    let i = 0;
    while (i < ns.length && !isItem(ns[i])) i++;
    while (i < ns.length) {
      const chunk: Node[] = [ns[i] as Node];
      i++;
      while (i < ns.length && !isItem(ns[i])) {
        chunk.push(ns[i] as Node);
        i++;
      }
      const text = flattenText(chunk);
      if (text) bullets.push(text);
    }
    return bullets;
  }
  for (const n of ns) {
    if (n.type === "environment" && LIST_ENVS.has(envNameOf(n))) {
      bullets.push(...collectItemBullets(n.content as Node[]));
    }
  }
  return bullets;
}

/** Leading brace groups of a custom entry env are its arguments (title, meta). */
function leadingGroupArgs(ns: Node[]): string[] {
  const args: string[] = [];
  for (const n of ns) {
    if (n.type === "whitespace" || n.type === "parbreak" || n.type === "comment") continue;
    if (n.type === "group") {
      args.push(flattenText(n.content));
      continue;
    }
    break;
  }
  return args;
}

/**
 * A generic résumé entry: a heading (one or more argument strings) plus its
 * bullets. Recognizes Jake's macros (\resumeSubheading/\resumeProjectHeading/
 * \resumeItem) AND generic layouts — custom per-entry environments
 * (joblong/projectentry/…), a standalone \textbf heading followed by an
 * itemize, and plain \item bullets. This is the superset the section
 * dispatch maps onto Work/Project/Education.
 */
interface Entry {
  kind: "subheading" | "project" | "generic";
  args: string[];
  /** project keyword string parsed from \resumeProjectHeading's \emph, if any */
  keywords?: string;
  items: string[];
}

function scanProjectHead(headArg: Node[]): { name: string; keywords: string } {
  let name = "";
  let keywords = "";
  const scan = (inner: Node[]): void => {
    for (const m of inner) {
      if (m.type === "macro" && m.content === "textbf" && m.args?.length && !name) {
        name = flattenText(m.args.flatMap((a) => a.content as Node[]));
      } else if (m.type === "macro" && m.content === "emph" && m.args?.length && !keywords) {
        keywords = flattenText(m.args.flatMap((a) => a.content as Node[]));
      } else if ("content" in m && Array.isArray(m.content)) {
        scan(m.content as Node[]);
      }
    }
  };
  scan(headArg);
  return { name, keywords };
}

function collectEntries(nodes: Node[]): Entry[] {
  const entries: Entry[] = [];
  const current = (): Entry | undefined => entries[entries.length - 1];
  const walk = (ns: Node[]): void => {
    for (const n of ns) {
      if (n.type === "environment") {
        const en = envNameOf(n);
        if (LIST_ENVS.has(en)) {
          // bullets belong to the most recent heading (\textbf/\resumeSubheading)
          const bullets = collectItemBullets(n.content as Node[]);
          const cur = current();
          if (cur) cur.items.push(...bullets);
          else if (bullets.length) entries.push({ kind: "generic", args: [], items: bullets });
        } else if (!LAYOUT_ENVS.has(en)) {
          // custom per-entry environment: leading groups are the heading args
          entries.push({
            kind: "generic",
            args: leadingGroupArgs(n.content as Node[]),
            items: collectItemBullets(n.content as Node[]),
          });
        }
        continue;
      }
      if (n.type !== "macro") {
        if ("content" in n && Array.isArray(n.content)) walk(n.content as Node[]);
        continue;
      }
      if (n.content === "resumeSubheading") {
        entries.push({ kind: "subheading", args: macroArgs(n).map(flattenText), items: [] });
      } else if (n.content === "resumeProjectHeading") {
        const args = macroArgs(n).map(flattenText);
        const headArg = (n.args ?? [])[0];
        const { name, keywords } = headArg
          ? scanProjectHead(headArg.content as Node[])
          : { name: "", keywords: "" };
        entries.push({
          kind: "project",
          args: [name || (args[0] ?? ""), args[1] ?? ""],
          keywords,
          items: [],
        });
      } else if (n.content === "resumeItem" && n.args?.length) {
        current()?.items.push(flattenText(n.args.flatMap((a) => a.content as Node[])));
      } else if (n.content === "textbf" && n.args?.length) {
        // standalone bold heading (e.g. resume.tex project titles); bullets follow
        entries.push({
          kind: "generic",
          args: [flattenText(n.args.flatMap((a) => a.content as Node[]))],
          items: [],
        });
      } else if (n.args) {
        for (const arg of n.args) walk(arg.content as Node[]);
      }
    }
  };
  walk(nodes);
  return entries;
}

/** First argument that parses as a date; the rest keep their order. */
function pickDate(args: string[]): {
  dates: { startDate?: string; endDate?: string };
  rest: string[];
} {
  for (let i = 0; i < args.length; i++) {
    const dates = parseDateRange(args[i] ?? "");
    if (dates.startDate) return { dates, rest: args.filter((_, j) => j !== i) };
  }
  return { dates: {}, rest: args };
}

/** Project dates: a range if present, else the first/last bare year in the meta line. */
function projectDates(meta: string): { startDate?: string; endDate?: string } {
  const range = parseDateRange(meta);
  if (range.startDate) return range;
  const years = meta.match(/\b(?:19|20)\d{2}\b/g);
  const start = years?.[0];
  const end = years?.[years.length - 1];
  if (start && end) return { startDate: start, endDate: end };
  return {};
}

/** skills itemize: sequence of \textbf{Group} {: a, b, c} pairs */
function parseSkills(nodes: Node[]): Skill[] {
  const skills: Skill[] = [];
  const walk = (ns: Node[]): void => {
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!n) continue;
      if (n.type === "macro" && n.content === "textbf" && n.args?.length) {
        const name = flattenText(n.args.flatMap((a) => a.content as Node[]));
        // following sibling group holds ": kw1, kw2, ..."
        let j = i + 1;
        while (j < ns.length && (ns[j]?.type === "whitespace" || ns[j]?.type === "parbreak")) j++;
        const next = ns[j];
        if (next?.type === "group") {
          const raw = flattenText(next.content).replace(/^:\s*/, "");
          skills.push({
            name,
            keywords: raw
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          });
        }
      } else if (n && "content" in n && Array.isArray(n.content)) {
        walk(n.content as Node[]);
      } else if (n?.type === "macro" && n.args) {
        for (const arg of n.args) walk(arg.content as Node[]);
      }
    }
  };
  walk(nodes);
  return skills;
}

/**
 * Split a table environment's content into rows (on \\) and cells (on &),
 * skipping the leading colspec/width groups that unknown table envs leave as
 * content (e.g. tabularx's {\linewidth}{@{}l X@{}}).
 */
function splitTableRows(ns: Node[]): string[][] {
  let start = 0;
  while (start < ns.length) {
    const n = ns[start];
    if (n?.type === "whitespace" || n?.type === "parbreak" || n?.type === "comment") start++;
    else if (n?.type === "group") start++;
    else break;
  }
  const rows: string[][] = [];
  let row: Node[][] = [];
  let cell: Node[] = [];
  const endCell = (): void => {
    row.push(cell);
    cell = [];
  };
  const endRow = (): void => {
    endCell();
    const flat = row.map(flattenText);
    if (flat.some((c) => c.length > 0)) rows.push(flat);
    row = [];
  };
  for (let i = start; i < ns.length; i++) {
    const n = ns[i];
    if (!n) continue;
    if (n.type === "string" && n.content === "&") endCell();
    else if (n.type === "macro" && (n.content === "\\" || n.content === "tabularnewline")) endRow();
    else cell.push(n);
  }
  if (cell.length || row.length) endRow();
  return rows;
}

/** Skills laid out as table rows: "Group & kw1, kw2, …" (one row per group). */
function parseSkillsTable(nodes: Node[]): Skill[] {
  const skills: Skill[] = [];
  const walk = (ns: Node[]): void => {
    for (const n of ns) {
      if (n.type === "environment" && /^tabular/.test(envNameOf(n))) {
        for (const row of splitTableRows(n.content as Node[])) {
          const name = (row[0] ?? "").replace(/[:\s]+$/, "").trim();
          const keywords = row
            .slice(1)
            .join(", ")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          if (name && keywords.length) skills.push({ name, keywords });
        }
      } else if ("content" in n && Array.isArray(n.content)) {
        walk(n.content as Node[]);
      }
    }
  };
  walk(nodes);
  return skills;
}

/**
 * Education laid out as table rows: "dates & Degree ... at Institution & (score)".
 * Institution comes from a trailing " at X" or a \textbf; degree/GPA from
 * parseDegreeLine over the remaining text.
 */
function parseEducationTable(nodes: Node[]): Education[] {
  const out: Education[] = [];
  const walk = (ns: Node[]): void => {
    for (const n of ns) {
      if (n.type === "environment" && /^tabular/.test(envNameOf(n))) {
        for (const row of splitTableRows(n.content as Node[])) {
          if (row.length < 2) continue;
          const dateCell = row[0] ?? "";
          const degreeCell = row[1] ?? "";
          const scoreCell = row.slice(2).join(" ");
          const atSplit = degreeCell.split(/\s+at\s+/);
          const institution = (
            atSplit.length >= 2 ? atSplit.slice(1).join(" at ") : degreeCell
          ).trim();
          const degreePart = atSplit.length >= 2 ? (atSplit[0] ?? "") : "";
          const dates = pickDate([dateCell, degreeCell, scoreCell]).dates;
          // degree/area from the degree text only; GPA/score from the score cell
          const degreeInfo = parseDegreeLine(degreePart);
          const scoreGpa = scoreCell.match(/C?GPA\s*[:\s]?\s*([\d.]+)\s*\/\s*([\d.]+)/i);
          const gpa =
            degreeInfo.gpa ??
            (scoreGpa ? { value: Number(scoreGpa[1]), scale: Number(scoreGpa[2]) } : undefined);
          const score = !gpa ? scoreCell.replace(/[()]/g, "").trim() : "";
          if (!institution) continue;
          out.push({
            institution,
            ...degreeInfo,
            ...(gpa ? { gpa } : {}),
            ...(score ? { score } : {}),
            ...dates,
            courses: [],
            coursework: [],
          });
        }
      } else if ("content" in n && Array.isArray(n.content)) {
        walk(n.content as Node[]);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * Map a heading entry to a Work item. Handles the two common argument
 * conventions by anchoring on the date: Jake's [company, location, position,
 * date] and single-line "Role | Company" custom-env headings. Company vs role
 * cannot always be told apart across templates (both bold different fields), so
 * for a 3-field heading we keep positional order (name, location, position) —
 * precision over recall: every string is preserved even if the label may swap.
 */
function mapWork(entry: Entry): Work | null {
  const args = entry.args;
  const dateIdx = args.findIndex((a) => parseDateRange(a).startDate);
  const dates = dateIdx >= 0 ? parseDateRange(args[dateIdx] ?? "") : {};
  let name = "";
  let position: string | undefined;
  let location: string | undefined;
  if (args.length >= 3 && dateIdx === args.length - 1) {
    // Jake's convention: {company}{location}{position}{date}
    name = (args[0] ?? "").trim();
    location = (args[1] ?? "").trim() || undefined;
    position = (args[2] ?? "").trim() || undefined;
  } else if (args.length >= 3 && dateIdx === 1) {
    // title-first convention (date second): {title}{date}{company}{location}
    position = (args[0] ?? "").trim() || undefined;
    name = (args[2] ?? "").trim();
    location = (args[3] ?? "").trim() || undefined;
  } else {
    // custom-env single heading, often "Role | Company" (+ a date arg)
    const rest = args.filter((_, j) => j !== dateIdx);
    const parts = (rest[0] ?? "").split(/\s*\|\s*/).map((p) => p.trim());
    if (parts.length >= 2) {
      position = parts[0] || undefined;
      name = parts.slice(1).join(" | ");
    } else {
      name = (rest[0] ?? "").trim();
      location = (rest[1] ?? "").trim() || undefined;
    }
  }
  if (!name && entry.items.length === 0) return null;
  return {
    name,
    ...(position ? { position } : {}),
    ...(location ? { location } : {}),
    ...dates,
    highlights: entry.items,
  };
}

function mapProject(entry: Entry): Project | null {
  const [name = "", meta = ""] = entry.args;
  if (!name.trim() && entry.items.length === 0) return null;
  const keywords = entry.keywords
    ? entry.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];
  return {
    name: name.trim(),
    keywords,
    ...(entry.kind === "project" ? parseDateRange(meta) : projectDates(meta)),
    highlights: entry.items,
    roles: [],
  };
}

/** Degree/qualification cues used to pick the degree field out of a heading. */
const DEGREE_RE =
  /GPA|bachelor|master|\bb\.?\s?tech\b|\bm\.?\s?tech\b|\bb\.?\s?sc\b|\bm\.?\s?sc\b|\bph\.?\s?d\b|diploma|degree|class\s+\d/i;

function mapEducationEntry(entry: Entry): Education | null {
  const { dates, rest } = pickDate(entry.args);
  const fields = rest.map((s) => s.trim()).filter(Boolean);
  let degreeIdx = fields.findIndex((s) => DEGREE_RE.test(s));
  if (degreeIdx < 0 && fields.length >= 2) degreeIdx = 1;
  const degreeLine = degreeIdx >= 0 ? (fields[degreeIdx] ?? "") : "";
  const institution = fields.find((_, i) => i !== degreeIdx) ?? "";
  if (!institution && !degreeLine) return null;
  return {
    institution,
    ...parseDegreeLine(degreeLine),
    ...dates,
    courses: [],
    coursework: [],
  };
}

/** Jake's-template custom macros: unified-latex needs their signatures to attach args. */
const JAKES_MACROS = {
  resumeSubheading: { signature: "m m m m" },
  resumeProjectHeading: { signature: "m m" },
  resumeItem: { signature: "m" },
  resumeSubSubheading: { signature: "m m" },
};

export function parseTexResume(source: string): ResumeDoc {
  const ast = parse(source);
  attachMacroArgs(ast, JAKES_MACROS);
  const docEnv =
    ast.content.find(
      (n): n is Ast.Environment => n.type === "environment" && envNameOf(n) === "document",
    ) ?? ast.content.find((n): n is Ast.Environment => n.type === "environment");

  const docContent = (docEnv?.content ?? ast.content) as Node[];
  const docEndLine = docEnv?.position?.end.line ?? source.split("\n").length;
  const sections = segment(docContent, docEndLine);

  let basics: Basics = { name: "", profiles: [] };
  const work: Work[] = [];
  const education: Education[] = [];
  const projects: Project[] = [];
  let skills: Skill[] = [];
  const sourceMap: TexSourceRange[] = [];

  // basics come from the preamble (the first heading-less block) only; later
  // unrecognized-heading blocks are also name===null and must not clobber it.
  let basicsParsed = false;

  for (const section of sections) {
    if (section.name === null) {
      if (!basicsParsed && flattenText(section.nodes).length > 0) {
        basics = parseBasics(section.nodes);
        basicsParsed = true;
        sourceMap.push({
          section: "basics",
          startLine: section.startLine,
          endLine: section.endLine,
        });
      }
      continue;
    }
    const mapName =
      section.name === "experience"
        ? "work"
        : section.name === "education"
          ? "education"
          : section.name;
    sourceMap.push({ section: mapName, startLine: section.startLine, endLine: section.endLine });

    if (section.name === "education") {
      const entries = collectEntries(section.nodes);
      for (const entry of entries) {
        const edu = mapEducationEntry(entry);
        if (edu) education.push(edu);
      }
      // custom layouts put education in a table with no entry macros at all
      if (entries.length === 0) education.push(...parseEducationTable(section.nodes));
    } else if (section.name === "experience") {
      for (const entry of collectEntries(section.nodes)) {
        const item = mapWork(entry);
        if (item) work.push(item);
      }
    } else if (section.name === "projects") {
      for (const entry of collectEntries(section.nodes)) {
        const item = mapProject(entry);
        if (item) projects.push(item);
      }
    } else if (section.name === "skills") {
      const parsed = parseSkills(section.nodes);
      skills = parsed.length > 0 ? parsed : parseSkillsTable(section.nodes);
    }
  }

  const fullText = flattenText(docContent);
  return ResumeDocSchema.parse({
    basics,
    work,
    education,
    skills,
    projects,
    awards: [],
    certificates: [],
    languages: [],
    meta: {
      sourceFormat: "tex",
      texSourceMap: sourceMap,
      regionSignals: {
        hasPhoto: /\\includegraphics/.test(source),
        hasDateOfBirth: detectDateOfBirth(fullText),
        hasMaritalStatus: detectMaritalStatus(fullText),
        hasNationality: detectNationality(fullText),
        hasDeclarationLine: detectDeclarationLine(fullText),
        spellingVariant: detectSpellingVariant(fullText),
        // pageCount deliberately absent: unknowable without compiling (D-023)
      },
    },
  });
}
