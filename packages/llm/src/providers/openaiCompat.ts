import {
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type LlmProvider,
  ProviderError,
  type ProviderId,
} from "../types.js";

/** Shared client for OpenAI-compatible chat APIs (Groq, OpenRouter). */
export class OpenAiCompatProvider implements LlmProvider {
  constructor(
    readonly id: ProviderId,
    private opts: {
      endpoint: string;
      apiKey?: string;
      model: string;
      extraHeaders?: Record<string, string>;
      fetch?: FetchLike;
    },
  ) {}

  async available(): Promise<boolean> {
    return Boolean(this.opts.apiKey);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const doFetch = this.opts.fetch ?? globalThis.fetch;
    const res = await doFetch(this.opts.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
        ...this.opts.extraHeaders,
      },
      body: JSON.stringify({
        model: this.opts.model,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new ProviderError(this.id, await res.text(), res.status);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new ProviderError(this.id, "malformed response");
    return { text, provider: this.id, model: this.opts.model };
  }
}

export function groqProvider(opts: { apiKey?: string; model?: string; fetch?: FetchLike }) {
  return new OpenAiCompatProvider("groq", {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: opts.model ?? "llama-3.3-70b-versatile",
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export function openrouterProvider(opts: { apiKey?: string; model?: string; fetch?: FetchLike }) {
  return new OpenAiCompatProvider("openrouter", {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: opts.model ?? "meta-llama/llama-3.3-70b-instruct:free",
    extraHeaders: { "x-title": "TailorATS" },
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
