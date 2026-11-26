import {
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type LlmProvider,
  ProviderError,
} from "../types.js";

/** Gemini free tier — the guided "free key in 2 minutes" path (PLAN §5 Phase 2). */
export class GeminiProvider implements LlmProvider {
  readonly id = "gemini" as const;
  private apiKey: string | undefined;
  private model: string;
  private fetch: FetchLike;

  constructor(opts: { apiKey?: string; model?: string; fetch?: FetchLike } = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "gemini-flash-latest";
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async available(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          ...(req.json ? { responseMimeType: "application/json" } : {}),
          ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
        },
      }),
    });
    if (!res.ok) throw new ProviderError(this.id, await res.text(), res.status);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (typeof text !== "string" || text === "")
      throw new ProviderError(this.id, "malformed response");
    return { text, provider: this.id, model: this.model };
  }
}
