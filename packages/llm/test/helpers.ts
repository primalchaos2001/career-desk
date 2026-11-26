import type { CompletionRequest, CompletionResult, LlmProvider, ProviderId } from "../src/types.js";

/** Scripted provider: returns queued texts in order; records requests. */
export class MockProvider implements LlmProvider {
  readonly id: ProviderId = "ollama";
  readonly requests: CompletionRequest[] = [];
  private queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async available(): Promise<boolean> {
    return true;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(req);
    const text = this.queue.shift();
    if (text === undefined) throw new Error("MockProvider queue empty");
    return { text, provider: this.id, model: "mock" };
  }
}

/** fetch stub: records calls, returns the canned body per call. */
export function fetchStub(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const fn = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}
