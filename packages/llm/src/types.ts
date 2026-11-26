/**
 * Provider plumbing (O-04, ADR D-024). Raw fetch, no provider SDKs: smaller
 * bundle, full control of CORS headers, and identical behavior in a Web
 * Worker and Node. Keys live in a config object the app fills from
 * localStorage (D-011) — this package never touches storage itself.
 */

export type ProviderId = "local" | "ollama" | "gemini" | "groq" | "openrouter" | "anthropic";

export interface CompletionRequest {
  system: string;
  user: string;
  /** ask the provider for JSON output where supported */
  json?: boolean;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  provider: ProviderId;
  model: string;
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** true if reachable/configured (Ollama on localhost, key present, ...) */
  available(): Promise<boolean>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export type FetchLike = typeof fetch;

/**
 * Model download/inference progress (D-056/O-19) — the on-device provider's
 * only source of "is this still working". Shape matches transformers.js's
 * own `progress_callback` payload for "initiate"/"download"/"progress"/
 * "done" (verified against the installed package, `progress` is already
 * loaded/total*100); "generating" is synthetic, emitted by LocalProvider
 * itself since no library callback covers the inference phase.
 */
export interface ModelProgressInfo {
  status: "initiate" | "download" | "progress" | "done" | "generating";
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface ProviderConfig {
  /**
   * Opt in to on-device inference leading the automatic chain (D-049/D-052).
   * Left unset, `createProviders`'s order and callers (the CLI, `pnpm eval`)
   * are unaffected — they never asked for a multi-hundred-MB model download.
   * The app sets this explicitly; nothing implicitly turns it on.
   */
  includeLocal?: boolean;
  /** override the default on-device model (onnx-community/Qwen3-0.6B-ONNX, D-058) */
  localModel?: string;
  /**
   * On-device download/inference progress (D-056/O-19). Only ever set inside
   * the Web Worker (worker.ts adds it after receiving the config over
   * postMessage — functions can't cross that boundary), same role `fetch`
   * plays below for injectability.
   */
  onProgress?: (info: ModelProgressInfo) => void;
  /** default http://localhost:11434 */
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** injectable for tests; defaults to globalThis.fetch */
  fetch?: FetchLike;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
