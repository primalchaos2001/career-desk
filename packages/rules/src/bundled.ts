// Generated from rulepacks/**/*.yaml by scripts/build-packs.ts — checked in.
import packsJson from "../generated/packs.json" with { type: "json" };
import { RulePack } from "./types.js";

/**
 * Browser-safe pack access (D-031). Bundlers inline the JSON; nothing here
 * touches `node:fs`, so the whole pipeline runs in a Web Worker (D-011).
 * Node code that needs fresh YAML (tests, eval harness, CLI) uses `./node`.
 */

const packs: Record<string, RulePack> = Object.fromEntries(
  Object.entries(packsJson as Record<string, unknown>).map(([id, raw]) => [
    id,
    RulePack.parse(raw),
  ]),
);

/** All pack ids, e.g. ["industry/finance", "region/us", ...]. */
export function packIds(): string[] {
  return Object.keys(packs);
}

/** Throws on an unknown id — callers pass ids from `packIds()` or a context map. */
export function getPack(packId: string): RulePack {
  const pack = packs[packId];
  if (!pack) throw new Error(`unknown rule pack "${packId}" (have: ${packIds().join(", ")})`);
  return pack;
}

export function getPacks(packIdList: string[]): RulePack[] {
  return packIdList.map(getPack);
}

export function allPacks(): RulePack[] {
  return Object.values(packs);
}
