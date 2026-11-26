import { pipeline, TextStreamer } from "@huggingface/transformers";
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ModelProgressInfo,
} from "../types.js";
import { ProviderError } from "../types.js";

// Qwen3-0.6B, not Qwen3-1.7B (D-058): the 1.7B model reproducibly OOM'd
// (onnxruntime "Can't create a session... std::bad_alloc") in a real browser
// without WebGPU, falling back to WASM — a common case, not an edge one.
// 0.6B's q4f16 weights are a single ~570MB file (no external .onnx_data
// shard), about half the download and comfortably lighter on WASM memory.
const DEFAULT_MODEL = "onnx-community/Qwen3-0.6B-ONNX";

// onnxruntime-node's "auto" device probes for a CUDA execution provider and
// throws (doesn't fall back) when a GPU driver is present but the CUDA
// runtime libraries aren't installed (e.g. libcublasLt) — a common WSL/driver-
// only setup, reproduced live against the real model in this session (D-050).
// The browser bundle (onnxruntime-web) has no such failure mode, so only
// Node is pinned to the always-safe "cpu" backend.
const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

/**
 * Runs entirely on-device via transformers.js (D-049): no API key, no
 * separate app to install. The package's own exports condition resolves to
 * onnxruntime-node in Node and onnxruntime-web (WebGPU, falling back to WASM)
 * in the browser — one code path, same as every other provider's "identical
 * in Web Worker and Node" contract (D-024).
 */
export class LocalProvider implements LlmProvider {
  readonly id = "local" as const;
  private model: string;
  private createGenerator: typeof pipeline;
  private onProgress?: (info: ModelProgressInfo) => void;
  private generatorPromise: ReturnType<typeof pipeline<"text-generation">> | null = null;

  constructor(
    opts: {
      model?: string;
      createGenerator?: typeof pipeline;
      onProgress?: (info: ModelProgressInfo) => void;
    } = {},
  ) {
    this.model = opts.model ?? DEFAULT_MODEL;
    // injectable for tests, same role `fetch` plays in the other providers —
    // real inference (the actual model, a real download) is a manual smoke
    // test (scripts/smoke.ts), not part of the fast CI suite.
    this.createGenerator = opts.createGenerator ?? pipeline;
    if (opts.onProgress) this.onProgress = opts.onProgress;
  }

  async available(): Promise<boolean> {
    // ponytail: always true, no capability probe. A genuine load failure
    // (unsupported device, blocked fetch) currently surfaces as complete()
    // throwing rather than a graceful degrade, since packages/pipeline's
    // resolveProvider has no fallback once a provider is chosen. Add a cheap
    // probe + pipeline-level fallback before O-15 makes this the default.
    return true;
  }

  private generator() {
    if (!this.generatorPromise) {
      const isQwen25 = this.model.includes("Qwen2.5");
      this.generatorPromise = this.createGenerator("text-generation", this.model, {
        device: isNode ? "cpu" : "auto",
        dtype: "q4f16",
        // biome-ignore lint/suspicious/noExplicitAny: transformers.js's own progress payload type
        ...(this.onProgress ? { progress_callback: this.onProgress as any } : {}),
        ...(isQwen25 ? { session_options: { graphOptimizationLevel: "disabled" } } : {}),
      });
    }
    return this.generatorPromise;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const generate = await this.generator();
    // No transformers.js callback covers the inference phase (only file
    // download/load does) — emit our own signal so the UI can tell "still
    // downloading" from "model loaded, now writing the review" (D-056/O-19).
    this.onProgress?.({ status: "generating" });
    const system = req.json
      ? `${req.system}\n\nRespond with ONLY a single JSON object — no prose, no markdown fences.`
      : req.system;
    // D-062: a per-token callback so the caller's stall timer resets while
    // tokens are still being produced, not just once before generation starts.
    // Without this, a slow-but-alive CPU/WASM decode (common on a contended
    // machine) looks identical to a genuinely hung generation and the
    // 300s stall timeout kills it as a false positive.
    const streamer = new TextStreamer(generate.tokenizer, {
      skip_prompt: true,
      callback_function: () => this.onProgress?.({ status: "generating" }),
    });
    const output = await generate(
      [
        { role: "system", content: system },
        { role: "user", content: req.user },
      ],
      {
        do_sample: false,
        streamer,
        ...(req.maxTokens !== undefined ? { max_new_tokens: req.maxTokens } : {}),
      },
    );
    const generatedText = output[0]?.generated_text;
    const text = Array.isArray(generatedText) ? generatedText.at(-1)?.content : undefined;
    if (typeof text !== "string") throw new ProviderError(this.id, "malformed response");
    return { text, provider: this.id, model: this.model };
  }
}
