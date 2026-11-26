import type { Finding, ResumeDoc } from "@tailorats/core";
import { getCheck } from "./checks/index.js";
import type { RulePack, RuleSpec } from "./types.js";

/**
 * Merge order per docs/ARCHITECTURE.md §5: stage → industry → role → region.
 * A later pack's rule with the same id replaces an earlier one (region wins),
 * and any pack may tune/disable prior rules via `overrides`.
 */
const KIND_ORDER = ["stage", "industry", "role", "region"] as const;

export function mergePacks(packs: RulePack[]): { rules: RuleSpec[]; packOf: Map<string, string> } {
  const ordered = [...packs].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const rules = new Map<string, RuleSpec>();
  const packOf = new Map<string, string>();

  for (const pack of ordered) {
    for (const rule of pack.rules) {
      rules.set(rule.id, rule);
      packOf.set(rule.id, pack.pack);
    }
  }
  for (const pack of ordered) {
    for (const [ruleId, override] of Object.entries(pack.overrides)) {
      const existing = rules.get(ruleId);
      if (!existing) continue;
      if (override.disabled) {
        rules.delete(ruleId);
        packOf.delete(ruleId);
        continue;
      }
      rules.set(ruleId, {
        ...existing,
        ...(override.priority ? { priority: override.priority } : {}),
        params: { ...existing.params, ...(override.params ?? {}) },
      });
    }
  }
  return { rules: [...rules.values()], packOf };
}

export function evaluate(doc: ResumeDoc, packs: RulePack[]): Finding[] {
  const { rules, packOf } = mergePacks(packs);
  const findings: Finding[] = [];

  for (const rule of rules) {
    const result = getCheck(rule.check)(doc, rule.params);
    if (!result.triggered) continue;
    findings.push({
      id: rule.id,
      layer: rule.layer,
      priority: rule.priority,
      title: rule.title,
      evidence: result.evidence ?? "condition met",
      why: rule.why,
      source: `rulepack:${packOf.get(rule.id)}#${rule.id}`,
      ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
    });
  }

  const order = { P0: 0, P1: 1, P2: 2 } as const;
  return findings.sort((a, b) => order[a.priority] - order[b.priority]);
}
