import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { RulePack } from "./types.js";

/**
 * Node-only YAML loading (tests, eval harness, future build step that
 * compiles packs to JSON for the browser bundle). Never import this from
 * browser code.
 */

export const RULEPACKS_DIR = fileURLToPath(new URL("../rulepacks", import.meta.url));

export function loadPackFile(path: string): RulePack {
  return RulePack.parse(yaml.load(readFileSync(path, "utf8")));
}

/** Load a pack by id, e.g. "region/us". */
export function loadPack(packId: string): RulePack {
  return loadPackFile(join(RULEPACKS_DIR, `${packId}.yaml`));
}

export function loadAllPacks(): RulePack[] {
  const packs: RulePack[] = [];
  for (const kind of readdirSync(RULEPACKS_DIR)) {
    for (const file of readdirSync(join(RULEPACKS_DIR, kind))) {
      if (file.endsWith(".yaml")) packs.push(loadPackFile(join(RULEPACKS_DIR, kind, file)));
    }
  }
  return packs;
}
