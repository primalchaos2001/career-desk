import type { ResumeDoc } from "@tailorats/core";
import type { CheckParams, CheckResult } from "../types.js";

/**
 * Named check registry (ADR D-014): rule packs reference checks by name;
 * checks are plain deterministic functions ResumeDoc → CheckResult. No DSL —
 * a new kind of condition means a new named check with unit tests.
 */
export type CheckFn = (doc: ResumeDoc, params: CheckParams) => CheckResult;

const not = (triggered: boolean, evidence?: string): CheckResult =>
  evidence === undefined ? { triggered } : { triggered, evidence };

/**
 * Evidence strings must stay short and scannable (D-044):
 * PDF-path entry names can be mangled multi-line blobs, so anything built from
 * doc content is truncated per item and capped in count.
 */
const shorten = (s: string, max = 45): string =>
  s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`;

const listNames = (names: string[], cap = 3): string => {
  const shown = names.slice(0, cap).map((n) => shorten(n));
  const more = names.length - shown.length;
  return shown.join(" · ") + (more > 0 ? ` (+${more} more)` : "");
};

export const checks: Record<string, CheckFn> = {
  /** photo detected at ingest (regionSignals) or basics.image set */
  "has-photo": (doc) =>
    not(
      doc.meta.regionSignals.hasPhoto || doc.basics.image !== undefined,
      doc.basics.image !== undefined ? "basics.image is set" : "photo detected in document",
    ),

  /** DOB / marital status / nationality present */
  "has-personal-details": (doc) => {
    const s = doc.meta.regionSignals;
    const found = [
      s.hasDateOfBirth && "date of birth",
      s.hasMaritalStatus && "marital status",
      s.hasNationality && "nationality",
    ].filter((x): x is string => Boolean(x));
    return not(found.length > 0, found.length > 0 ? `found: ${found.join(", ")}` : undefined);
  },

  "has-declaration-line": (doc) =>
    not(doc.meta.regionSignals.hasDeclarationLine, "declaration line detected near end of resume"),

  /** params: { max: number } */
  "page-count-exceeds": (doc, params) => {
    const max = typeof params.max === "number" ? params.max : 1;
    const pages = doc.meta.regionSignals.pageCount;
    return not(
      pages !== undefined && pages > max,
      pages !== undefined ? `${pages} pages` : undefined,
    );
  },

  /** params: { expected: "en-US" | "en-GB" } — only flags a positive mismatch */
  "spelling-variant-mismatch": (doc, params) => {
    const detected = doc.meta.regionSignals.spellingVariant;
    const expected = params.expected;
    const mismatch =
      (detected === "en-US" || detected === "en-GB" || detected === "mixed") &&
      detected !== expected;
    return not(
      mismatch,
      mismatch ? `detected ${detected}, expected ${String(expected)}` : undefined,
    );
  },

  /**
   * Fires only on a *mixed* en-US/en-GB document; either variant used
   * consistently passes. For regions where both conventions are accepted
   * (India — D-044); the stricter expected-variant regions keep
   * spelling-variant-mismatch.
   */
  "spelling-mixed": (doc) =>
    not(
      doc.meta.regionSignals.spellingVariant === "mixed",
      "mixed en-US and en-GB spellings in one document",
    ),

  /** no GitHub anywhere: neither a profile nor any project link */
  "github-missing": (doc) => {
    const inProfiles = doc.basics.profiles.some((p) => p.network.toLowerCase() === "github");
    const inProjects = doc.projects.some((p) => p.githubUrl !== undefined);
    return not(!inProfiles && !inProjects, "no GitHub profile or project links found");
  },

  "projects-missing": (doc) => not(doc.projects.length === 0, "projects section empty or absent"),

  /** projects exist but some have no URL at all */
  "projects-unlinked": (doc) => {
    const unlinked = doc.projects.filter((p) => p.url === undefined && p.githubUrl === undefined);
    return not(
      doc.projects.length > 0 && unlinked.length > 0,
      unlinked.length > 0
        ? `${unlinked.length} of ${doc.projects.length} projects have no link: ${listNames(
            unlinked.map((p) => p.name),
          )}`
        : undefined,
    );
  },

  "gpa-missing": (doc) =>
    not(
      doc.education.length > 0 &&
        doc.education.every((e) => e.gpa === undefined && e.score === undefined),
      "no GPA or score in any education entry",
    ),

  "coursework-missing": (doc) =>
    not(
      doc.education.length > 0 &&
        doc.education.every((e) => e.coursework.length === 0 && e.courses.length === 0),
      "no relevant coursework listed",
    ),

  "work-missing": (doc) => not(doc.work.length === 0, "work experience section empty or absent"),

  "leadership-missing": (doc) => {
    const hasAwards = doc.awards.length > 0;
    const leadershipKeywords = [
      "leader",
      "leadership",
      "president",
      "founder",
      "co-founder",
      "captain",
      "officer",
      "lead",
      "chair",
      "director",
      "manager",
    ];

    const hasLeadershipRole =
      doc.work.some((w) => {
        const pos = (w.position || "").toLowerCase();
        return leadershipKeywords.some((k) => pos.includes(k));
      }) ||
      doc.projects.some((p) =>
        p.roles.some((r) => leadershipKeywords.some((k) => r.toLowerCase().includes(k))),
      );

    return not(
      !hasAwards && !hasLeadershipRole,
      "no awards or leadership roles found in work or projects",
    );
  },

  /**
   * Impact-layer heuristic: bullet points with no digits anywhere rarely
   * quantify outcomes. params: { minRatio: number } — trigger when more than
   * minRatio of all highlights are number-free (default 0.7).
   */
  "unquantified-highlights": (doc, params) => {
    const minRatio = typeof params.minRatio === "number" ? params.minRatio : 0.7;
    const highlights = [
      ...doc.work.flatMap((w) => w.highlights),
      ...doc.projects.flatMap((p) => p.highlights),
    ];
    if (highlights.length === 0) return { triggered: false };
    const numberFree = highlights.filter((h) => !/\d/.test(h));
    const ratio = numberFree.length / highlights.length;
    return not(
      ratio > minRatio,
      `${numberFree.length} of ${highlights.length} bullets contain no numbers`,
    );
  },

  "skills-keywords-missing": (doc, params) => {
    const anyOf = Array.isArray(params.anyOf) ? (params.anyOf as string[]) : [];
    const match = params.match === "exact" ? "exact" : "substring";
    const label = typeof params.label === "string" ? params.label : "required keywords";

    const hasMatch = doc.skills.some((s) =>
      s.keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        return anyOf.some((val) => {
          const valLower = val.toLowerCase();
          if (match === "exact") {
            return kwLower === valLower;
          }
          return kwLower.includes(valLower);
        });
      }),
    );
    return not(!hasMatch, `No ${label} listed in skills`);
  },

  "certifications-missing": (doc, params) => {
    const orSkillKeywords = Array.isArray(params.orSkillKeywords)
      ? (params.orSkillKeywords as string[])
      : [];
    const hasCert = doc.certificates.length > 0;
    const hasSkillMatch = doc.skills.some((s) =>
      s.keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        return orSkillKeywords.some((val) => kwLower.includes(val.toLowerCase()));
      }),
    );
    return not(!hasCert && !hasSkillMatch, "No certifications or matching skill keywords found");
  },

  "certificates-unlinked": (doc) => {
    const unlinked = doc.certificates.filter((c) => !c.url || c.url.trim() === "");
    return not(
      doc.certificates.length > 0 && unlinked.length > 0,
      unlinked.length > 0 ? `${unlinked.map((c) => c.name).join(", ")}` : undefined,
    );
  },

  "quantify-business-impact": (doc, params) => {
    const minRatio = typeof params.minRatio === "number" ? params.minRatio : 0.3;
    const highlights = [
      ...doc.work.flatMap((w) => w.highlights),
      ...doc.projects.flatMap((p) => p.highlights),
    ];
    if (highlights.length === 0) return { triggered: false };
    const businessQuantifyRegex =
      /%|[$\u00A3\u20AC\u20A8\u20B9\u20A8]|\b(USD|INR|EUR|GBP|Rs)\b|\b\d+\s*(m|k|b|M|K|B|x|X)\b|\b(million|billion|thousand|percent|percentage|headcount|users?|clients?|customers?|revenue|profit|budget|ROI|KPIs?|retention|conversion|dau|mau|nps|engagement|ctr|ltv|cac|churn|acquisition|active)\b/i;
    const unquantified = highlights.filter((h) => !businessQuantifyRegex.test(h));
    const ratio = unquantified.length / highlights.length;
    return not(
      ratio > minRatio,
      ratio > minRatio
        ? `${unquantified.length} of ${highlights.length} bullets lack business impact metrics (%, $, scale, or headcount)`
        : undefined,
    );
  },

  "highlights-keywords-missing": (doc, params) => {
    const anyOf = Array.isArray(params.anyOf) ? (params.anyOf as string[]) : [];
    const label = typeof params.label === "string" ? params.label : "required keywords";
    const highlights = [
      ...doc.work.flatMap((w) => w.highlights),
      ...doc.projects.flatMap((p) => p.highlights),
      ...(doc.basics.summary ? [doc.basics.summary] : []),
    ];
    const hasMatch = highlights.some((h) => {
      const hLower = h.toLowerCase();
      return anyOf.some((val) => hLower.includes(val.toLowerCase()));
    });
    return not(!hasMatch, `No highlights or summary mention ${label}`);
  },

  "leadership-scope-required": (doc) => {
    const leadershipKeywords = [
      "lead",
      "leader",
      "leadership",
      "president",
      "founder",
      "co-founder",
      "captain",
      "officer",
      "chair",
      "director",
      "manager",
      "chief",
      "vp",
      "head",
      "spearheaded",
      "managed",
      "directed",
      "supervised",
      "founded",
      "chaired",
      "orchestrated",
      "steered",
    ];
    const hasLeadership =
      doc.work.some((w) => {
        const pos = (w.position || "").toLowerCase();
        const inPos = leadershipKeywords.some((k) => pos.includes(k));
        const inHighlights = w.highlights.some((h) =>
          /\b(led|managed|spearheaded|directed|supervised|founded|co-founded|chaired|orchestrated|steered)\b/i.test(
            h,
          ),
        );
        return inPos || inHighlights;
      }) ||
      doc.projects.some((p) => {
        const inRoles = p.roles.some((r) =>
          leadershipKeywords.some((k) => r.toLowerCase().includes(k)),
        );
        const inHighlights = p.highlights.some((h) =>
          /\b(led|managed|spearheaded|directed|supervised|founded|co-founded|chaired|orchestrated|steered)\b/i.test(
            h,
          ),
        );
        return inRoles || inHighlights;
      });
    return not(
      !hasLeadership,
      "no clear leadership scope or management evidence found in work or projects",
    );
  },

  "career-progression-recommended": (doc) => {
    if (doc.work.length === 0) return { triggered: false };

    // 1. Promotion keywords
    const hasPromoKeyword = doc.work.some((w) =>
      w.highlights.some((h) => /\b(promoted|promotion|promotions)\b/i.test(h)),
    );
    if (hasPromoKeyword) return { triggered: false };

    // 2. Multiple roles at same company
    const companies = doc.work.map((w) =>
      (w.name || "")
        .toLowerCase()
        .replace(/\b(inc|ltd|co|corp|corporation|llc|gmbh)\.?\b/g, "")
        .trim(),
    );
    const uniqueCompanies = new Set(companies.filter(Boolean));
    const hasMultipleRolesSameCompany = companies.length > uniqueCompanies.size;
    if (hasMultipleRolesSameCompany) return { triggered: false };

    // 3. Staged title checks (e.g. Intern/Analyst -> Associate/Senior/Manager)
    const positions = doc.work.map((w) => (w.position || "").toLowerCase());
    const hasInternOrJunior = positions.some(
      (p) =>
        p.includes("intern") ||
        p.includes("junior") ||
        p.includes("trainee") ||
        p.includes("analyst"),
    );
    const hasSeniorOrManager = positions.some(
      (p) =>
        p.includes("senior") ||
        p.includes("lead") ||
        p.includes("manager") ||
        p.includes("associate") ||
        p.includes("director") ||
        p.includes("head") ||
        p.includes("president") ||
        p.includes("vp"),
    );
    const hasTitleProgression = hasInternOrJunior && hasSeniorOrManager;
    if (hasTitleProgression) return { triggered: false };

    return {
      triggered: true,
      evidence:
        "no promotion keywords, multiple roles at the same company, or title progression detected",
    };
  },

  "extracurricular-impact-recommended": (doc) => {
    const hasAwards = doc.awards.length > 0;
    const hasInterestsSection = doc.meta.texSourceMap.some((s) => s.section === "interests");

    const ecKeywords =
      /\b(volunteer|volunteered|volunteering|ngo|non-profit|nonprofit|charity|extracurricular|extracurriculars|association|fraternity|sorority|club|society|community|varsity|athletics|co-curricular)\b/i;

    const hasEcInWorkOrProjects =
      doc.work.some(
        (w) =>
          ecKeywords.test(w.name || "") ||
          ecKeywords.test(w.position || "") ||
          w.highlights.some((h) => ecKeywords.test(h)),
      ) ||
      doc.projects.some(
        (p) =>
          ecKeywords.test(p.name || "") ||
          p.roles.some((r) => ecKeywords.test(r)) ||
          p.highlights.some((h) => ecKeywords.test(h)),
      );

    return not(
      !hasAwards && !hasInterestsSection && !hasEcInWorkOrProjects,
      "no extracurricular activities, community service, or student organization roles detected",
    );
  },
};

export function getCheck(name: string): CheckFn {
  const fn = checks[name];
  if (!fn) throw new Error(`unknown check "${name}" — register it in packages/rules/src/checks/`);
  return fn;
}
