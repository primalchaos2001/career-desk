import type { z } from "zod";
import type { CompletionRequest, LlmProvider } from "./types.js";

/**
 * Structured-output wrapper (D-007): ask for JSON, strip code fences, zod-
 * validate; on failure retry ONCE with the validation error appended so the
 * model can correct itself. Budget: ≤2 calls per structured request.
 */

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** Extract a JSON payload from model text (bare, fenced, or embedded). */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.search(/[{[]/);
  if (start === -1) return text.trim();
  return text.slice(start).trim();
}

/**
 * Best-effort repair for JSON truncated mid-array by a token-budget cutoff
 * (D-059/D-063/D-065/D-068) — a length problem, not a malformed-JSON mistake
 * the model can fix via the retry-with-error prompt below. Scans for the
 * LAST point where every currently-open object/array had already closed a
 * complete element (i.e., right after a `}`/`]` outside a string), cuts
 * there, and closes whatever containers were still open at that point.
 * Salvages the elements the model finished before running out of budget
 * instead of discarding the entire response for the sake of the one
 * incomplete tail element. Returns null if no safe cut point exists at all
 * (truncation happened before a single element ever completed).
 */
export function repairTruncatedJson(text: string): string | null {
  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escaped = false;
  let lastSafeCutIndex = -1;
  let lastSafeStack: ("{" | "[")[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      lastSafeCutIndex = i + 1;
      lastSafeStack = [...stack];
    }
  }

  if (lastSafeCutIndex === -1) return null;
  const closers = lastSafeStack
    .map((c) => (c === "{" ? "}" : "]"))
    .reverse()
    .join("");
  return text.slice(0, lastSafeCutIndex) + closers;
}

export async function completeStructured<Schema extends z.ZodType>(
  provider: LlmProvider,
  req: Omit<CompletionRequest, "json">,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let lastError = "";
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? req.user
        : `${req.user}\n\nYour previous response was invalid: ${lastError}\n` +
          "Respond again with ONLY the corrected JSON object.";
    const result = await provider.complete({ ...req, user, json: true });
    lastRaw = result.text;
    const jsonText = extractJson(result.text);
    try {
      const parsed: unknown = JSON.parse(jsonText);
      const validated = schema.safeParse(parsed);
      if (validated.success) return validated.data;
      lastError = JSON.stringify(validated.error.issues.slice(0, 5));
    } catch (e) {
      // A truncated array is recoverable without spending the retry budget
      // on a second real model call — salvage what finished, don't demand
      // a redo of work already done.
      const repaired = repairTruncatedJson(jsonText);
      if (repaired) {
        try {
          const validated = schema.safeParse(JSON.parse(repaired));
          if (validated.success) return validated.data;
        } catch {
          // repaired text still didn't parse — fall through to the normal
          // retry-with-error path below, same as any other malformed JSON.
        }
      }
      lastError = `not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new StructuredOutputError(`validation failed after retry: ${lastError}`, lastRaw);
}
