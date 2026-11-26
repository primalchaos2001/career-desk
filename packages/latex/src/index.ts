/**
 * Document rendering abstraction — interface only in Phase 0; the SwiftLaTeX
 * WASM implementation (and later typst.ts) arrives in Phase 3
 * (docs/ARCHITECTURE.md §8, ADR D-006). Compilation is fully client-side.
 */

import type { TexPatch } from "@tailorats/core";

export interface CompileDiagnostic {
  severity: "error" | "warning";
  message: string;
  line?: number;
}

export type CompileResult =
  | { ok: true; pdf: Uint8Array; log: string }
  | { ok: false; diagnostics: CompileDiagnostic[]; log: string };

export interface DocumentRenderer {
  readonly id: "swiftlatex-pdftex" | "typst";
  compile(source: string): Promise<CompileResult>;
}

/**
 * Apply a context-anchored patch to .tex source. Anchor-based (not line-based)
 * so patches survive unrelated user edits. Returns null if the anchor or old
 * text can no longer be found (caller shows the suggestion as manual).
 */
export function applyTexPatch(source: string, patch: TexPatch): string | null {
  const anchorIdx = source.indexOf(patch.anchor);
  if (anchorIdx === -1) return null;
  const oldIdx = source.indexOf(patch.old, anchorIdx);
  if (oldIdx === -1) return null;
  return source.slice(0, oldIdx) + patch.new + source.slice(oldIdx + patch.old.length);
}
