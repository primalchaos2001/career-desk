import {
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type LlmProvider,
  ProviderError,
} from "../types.js";

/**
 * Anthropic direct-from-browser (ARCHITECTURE §6): requires the
 * `anthropic-dangerous-direct-browser-access` header. BYO paid key — last in
 * the default provider order because it isn't free (D-024).
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  private apiKey: string | undefined;
  private model: string;
  private fetch: FetchLike;

  constructor(opts: { apiKey?: string; model?: string; fetch?: FetchLike } = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "claude-haiku-4-5-20251001";
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async available(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });
    if (!res.ok) throw new ProviderError(this.id, await res.text(), res.status);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (typeof text !== "string" || text === "")
      throw new ProviderError(this.id, "malformed response");
    return { text, provider: this.id, model: this.model };
  }
}
