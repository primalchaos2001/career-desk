import {
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type LlmProvider,
  ProviderError,
} from "../types.js";

/** Local, private, free — the first choice in the provider order (D-024). */
export class OllamaProvider implements LlmProvider {
  readonly id = "ollama" as const;
  private baseUrl: string;
  private model: string;
  private fetch: FetchLike;

  constructor(opts: { baseUrl?: string; model?: string; fetch?: FetchLike } = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.model = opts.model ?? "llama3.1:8b";
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        ...(req.json ? { format: "json" } : {}),
        options: req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {},
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new ProviderError(this.id, await res.text(), res.status);
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content;
    if (typeof text !== "string") throw new ProviderError(this.id, "malformed response");
    return { text, provider: this.id, model: this.model };
  }
}
