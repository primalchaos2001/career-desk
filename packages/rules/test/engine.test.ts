import { describe, expect, it } from "vitest";
import { evaluate, mergePacks } from "../src/engine.js";
import { RulePack } from "../src/types.js";
import { makeDoc } from "./helpers.js";

const stagePack = RulePack.parse({
  pack: "stage/student",
  kind: "stage",
  name: "Student",
  version: "0.0.1",
  rules: [
    {
      id: "shared-page-rule",
      title: "stage version",
      priority: "P2",
      check: "page-count-exceeds",
      params: { max: 3 },
      why: "stage default",
      source: { url: "https://example.org" },
    },
  ],
});

const regionPack = RulePack.parse({
  pack: "region/us",
  kind: "region",
  name: "US",
  version: "0.0.1",
  rules: [
    {
      id: "shared-page-rule",
      title: "region version",
      priority: "P1",
      check: "page-count-exceeds",
      params: { max: 1 },
      why: "region wins",
      source: { url: "https://example.org" },
    },
  ],
});

describe("mergePacks", () => {
  it("region replaces a same-id rule from stage regardless of input order", () => {
    for (const packs of [
      [stagePack, regionPack],
      [regionPack, stagePack],
    ]) {
      const { rules } = mergePacks(packs);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.title).toBe("region version");
      expect(rules[0]?.params.max).toBe(1);
    }
  });

  it("overrides can disable and retune rules from earlier packs", () => {
    const disabler = RulePack.parse({
      pack: "region/india",
      kind: "region",
      name: "India",
      version: "0.0.1",
      rules: [],
      overrides: { "shared-page-rule": { disabled: true } },
    });
    const { rules } = mergePacks([stagePack, disabler]);
    expect(rules).toHaveLength(0);

    const retuner = RulePack.parse({
      pack: "region/india",
      kind: "region",
      name: "India",
      version: "0.0.1",
      rules: [],
      overrides: { "shared-page-rule": { priority: "P0", params: { max: 2 } } },
    });
    const tuned = mergePacks([stagePack, retuner]).rules[0];
    expect(tuned?.priority).toBe("P0");
    expect(tuned?.params.max).toBe(2);
    expect(tuned?.title).toBe("stage version");
  });
});

describe("evaluate", () => {
  it("emits findings with rulepack provenance and P0-first ordering", () => {
    const doc = makeDoc({ regionSignals: { pageCount: 4 } });
    const findings = evaluate(doc, [stagePack, regionPack]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.source).toBe("rulepack:region/us#shared-page-rule");
    expect(findings[0]?.evidence).toBe("4 pages");
  });

  it("returns nothing on a clean doc", () => {
    expect(evaluate(makeDoc(), [stagePack, regionPack])).toHaveLength(0);
  });
});
