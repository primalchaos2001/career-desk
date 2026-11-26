/**
 * Compiles rulepacks/**\/*.yaml → generated/packs.json for the browser bundle
 * (ARCHITECTURE §5: "Build step compiles YAML → JSON bundled with the app;
 * community PRs edit only YAML").
 *
 *   pnpm --filter @tailorats/rules run build:packs
 *
 * The output is checked in so the app has no build-order dependency on this
 * script; `packs.test.ts` fails CI if the checked-in JSON drifts from the YAML.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllPacks, RULEPACKS_DIR } from "../src/node.js";
import type { RulePack } from "../src/types.js";

export const GENERATED_PACKS_PATH = join(RULEPACKS_DIR, "../generated/packs.json");

/** packId → RulePack, sorted by id for a stable diff. */
export function compilePacks(): Record<string, RulePack> {
  const packs = loadAllPacks().sort((a, b) => a.pack.localeCompare(b.pack));
  return Object.fromEntries(packs.map((p) => [p.pack, p]));
}

export function serializePacks(): string {
  return `${JSON.stringify(compilePacks(), null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = serializePacks();
  writeFileSync(GENERATED_PACKS_PATH, json);
  console.log(`wrote ${GENERATED_PACKS_PATH} (${Object.keys(JSON.parse(json)).length} packs)`);
}
