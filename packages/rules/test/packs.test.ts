import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_PACKS_PATH, serializePacks } from "../scripts/build-packs.js";
import { allPacks, getPack, getPacks, packIds } from "../src/bundled.js";
import { evaluate } from "../src/engine.js";
import { loadAllPacks } from "../src/node.js";
import { makeDoc } from "./helpers.js";

describe("generated/packs.json", () => {
  it("is up to date with the YAML sources", () => {
    const onDisk = readFileSync(GENERATED_PACKS_PATH, "utf8");
    expect(
      onDisk,
      "generated/packs.json is stale — run `pnpm --filter @tailorats/rules run build:packs`",
    ).toBe(serializePacks());
  });

  it("contains every YAML pack", () => {
    expect(packIds().sort()).toEqual(
      loadAllPacks()
        .map((p) => p.pack)
        .sort(),
    );
  });
});

describe("bundled (browser) pack access", () => {
  it("getPack returns a validated pack; unknown ids throw", () => {
    expect(getPack("region/us").kind).toBe("region");
    expect(() => getPack("region/atlantis")).toThrow(/unknown rule pack/);
  });

  it("getPacks preserves order, and evaluates identically to the YAML loader", () => {
    const ids = ["stage/student", "role/swe-intern", "region/us"];
    expect(getPacks(ids).map((p) => p.pack)).toEqual(ids);

    const doc = makeDoc({ regionSignals: { hasPhoto: true, pageCount: 2 } });
    const fromBundle = evaluate(doc, getPacks(ids));
    const fromYaml = evaluate(
      doc,
      loadAllPacks().filter((p) => ids.includes(p.pack)),
    );
    expect(fromBundle.map((f) => f.id).sort()).toEqual(fromYaml.map((f) => f.id).sort());
    expect(fromBundle.map((f) => f.id)).toContain("us-no-photo");
  });

  it("allPacks() evaluates a clean doc without throwing (all checks registered)", () => {
    expect(allPacks().length).toBeGreaterThanOrEqual(9);
    expect(() => evaluate(makeDoc(), allPacks())).not.toThrow();
  });
});
