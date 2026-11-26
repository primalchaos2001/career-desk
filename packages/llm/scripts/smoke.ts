/**
 * Live smoke test (NOT in CI — needs a real key, local Ollama, or a real
 * Qwen3-0.6B download for LocalProvider — D-049/D-058):
 *   GEMINI_API_KEY=... pnpm --filter @tailorats/llm exec tsx scripts/smoke.ts
 * Tries each configured provider with a tiny structured request.
 */
import { z } from "zod";
import { createProviders } from "../src/factory.js";
import { LocalProvider } from "../src/providers/local.js";
import { completeStructured } from "../src/structured.js";

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const providers = [
  new LocalProvider(),
  ...createProviders({
    ...(env.GEMINI_API_KEY ? { geminiApiKey: env.GEMINI_API_KEY } : {}),
    ...(env.GROQ_API_KEY ? { groqApiKey: env.GROQ_API_KEY } : {}),
    ...(env.OPENROUTER_API_KEY ? { openrouterApiKey: env.OPENROUTER_API_KEY } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
  }),
];

const schema = z.object({ greeting: z.string() });

for (const provider of providers) {
  if (!(await provider.available())) {
    console.log(`${provider.id}: not configured/reachable — skipped`);
    continue;
  }
  try {
    const out = await completeStructured(
      provider,
      {
        system: "You respond with JSON only.",
        user: 'Return {"greeting": "hello from <your model name>"}',
        maxTokens: 100,
      },
      schema,
    );
    console.log(`${provider.id}: OK — ${out.greeting}`);
  } catch (e) {
    console.log(`${provider.id}: FAILED — ${e instanceof Error ? e.message : e}`);
  }
}
