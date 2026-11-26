import type { pipeline } from "@huggingface/transformers";
import { describe, expect, it } from "vitest";
import { LocalProvider } from "../src/providers/local.js";
import { ProviderError } from "../src/types.js";

/**
 * Fake generator: records how it was invoked, returns a canned chat-shaped
 * response. Real-model inference (the actual download, real JSON-mode
 * reliability) is a manual smoke test (scripts/smoke.ts) — this proves the
 * request/response mapping is correct, fast and deterministically, the same
 * role `fetchStub` plays for the fetch-based providers.
 */
function fakeGenerator(reply: string) {
  const calls: { task: string; model: string | undefined; options: unknown }[] = [];
  const generateCalls: { messages: unknown; options: unknown }[] = [];
  const createGenerator = (async (task: string, model?: string, options?: unknown) => {
    calls.push({ task, model, options });
    const generate = async (messages: unknown, genOptions: unknown) => {
      generateCalls.push({ messages, options: genOptions });
      return [
        { generated_text: [...(messages as object[]), { role: "assistant", content: reply }] },
      ];
    };
    // TextStreamer reads all_special_ids at construction; this fake never
    // calls streamer.put(), so nothing beyond that is needed.
    generate.tokenizer = { all_special_ids: [] };
    return generate;
  }) as unknown as typeof pipeline;
  return { createGenerator, calls, generateCalls };
}

describe("LocalProvider", () => {
  it("is always available (D-049: automatic, no opt-in gate)", async () => {
    expect(await new LocalProvider().available()).toBe(true);
  });

  it("loads the pipeline once with dtype=q4f16 and the default model; device=cpu under Node", async () => {
    const { createGenerator, calls } = fakeGenerator("hi");
    const p = new LocalProvider({ createGenerator });
    await p.complete({ system: "s", user: "u" });
    await p.complete({ system: "s", user: "u2" });
    expect(calls).toHaveLength(1); // singleton — not reloaded per call
    expect(calls[0]).toMatchObject({
      task: "text-generation",
      model: "onnx-community/Qwen3-0.6B-ONNX",
      // pinned to cpu under Node — onnxruntime-node's "auto" throws instead of
      // falling back when a GPU driver is present without CUDA runtime libs
      // (reproduced live against the real model, D-050).
      options: { device: "cpu", dtype: "q4f16" },
    });
  });

  it("sends system/user as chat messages and returns the assistant reply", async () => {
    const { createGenerator, generateCalls } = fakeGenerator("plain answer");
    const p = new LocalProvider({ createGenerator, model: "m1" });
    const res = await p.complete({ system: "You are helpful.", user: "hello" });
    expect(res).toEqual({ text: "plain answer", provider: "local", model: "m1" });
    expect(generateCalls[0]?.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hello" },
    ]);
  });

  it("appends the JSON-only instruction to system when json:true is requested", async () => {
    const { createGenerator, generateCalls } = fakeGenerator('{"a":1}');
    const p = new LocalProvider({ createGenerator });
    await p.complete({ system: "You are helpful.", user: "hello", json: true });
    const sent = generateCalls[0]?.messages as { role: string; content: string }[];
    expect(sent[0]?.content).toContain("You are helpful.");
    expect(sent[0]?.content).toContain("ONLY a single JSON object");
  });

  it("uses greedy decoding and passes maxTokens through as max_new_tokens only when given", async () => {
    const { createGenerator, generateCalls } = fakeGenerator("x");
    const p = new LocalProvider({ createGenerator });
    await p.complete({ system: "s", user: "u" });
    expect(generateCalls[0]?.options).toMatchObject({ do_sample: false });
    await p.complete({ system: "s", user: "u", maxTokens: 256 });
    expect(generateCalls[1]?.options).toMatchObject({ do_sample: false, max_new_tokens: 256 });
  });

  it("throws ProviderError when the generator returns a malformed shape", async () => {
    const createGenerator = (async () => {
      const generate = async () => [{}];
      generate.tokenizer = { all_special_ids: [] };
      return generate;
    }) as unknown as typeof pipeline;
    const p = new LocalProvider({ createGenerator });
    await expect(p.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
    });
    // sanity: it really is the shared ProviderError, not a lookalike
    await expect(p.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(ProviderError);
  });
});
