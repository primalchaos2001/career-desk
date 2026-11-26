import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { LocalProvider } from "./providers/local.js";
import { OllamaProvider } from "./providers/ollama.js";
import { groqProvider, openrouterProvider } from "./providers/openaiCompat.js";
import type { LlmProvider, ProviderConfig } from "./types.js";

/**
 * Default preference order (D-024): free & private first, paid keys last.
 * Ollama (local) → Gemini free tier → Groq free tier → OpenRouter free
 * models → Anthropic (BYO paid key).
 *
 * `config.includeLocal` (D-049/D-052) prepends on-device inference ahead of
 * all of these — it's the only option with truly zero setup (no key, no
 * separate app). Opt-in, not automatic: the CLI and `pnpm eval` never set it,
 * so a multi-hundred-MB model download never surprises a script that didn't
 * ask for one; the app sets it explicitly. A user who wants a configured key
 * to win instead picks that provider explicitly (`AnalyzeInput`'s `{provider}`
 * form bypasses this automatic chain entirely); a provider setup screen is
 * what will expose that choice in the app.
 */
export function createProviders(config: ProviderConfig = {}): LlmProvider[] {
  const f = config.fetch ? { fetch: config.fetch } : {};
  const local = config.includeLocal
    ? [
        new LocalProvider({
          ...(config.localModel ? { model: config.localModel } : {}),
          ...(config.onProgress ? { onProgress: config.onProgress } : {}),
        }),
      ]
    : [];
  return [
    ...local,
    new OllamaProvider({
      ...(config.ollamaBaseUrl ? { baseUrl: config.ollamaBaseUrl } : {}),
      ...(config.ollamaModel ? { model: config.ollamaModel } : {}),
      ...f,
    }),
    new GeminiProvider({
      ...(config.geminiApiKey ? { apiKey: config.geminiApiKey } : {}),
      ...(config.geminiModel ? { model: config.geminiModel } : {}),
      ...f,
    }),
    groqProvider({
      ...(config.groqApiKey ? { apiKey: config.groqApiKey } : {}),
      ...(config.groqModel ? { model: config.groqModel } : {}),
      ...f,
    }),
    openrouterProvider({
      ...(config.openrouterApiKey ? { apiKey: config.openrouterApiKey } : {}),
      ...(config.openrouterModel ? { model: config.openrouterModel } : {}),
      ...f,
    }),
    new AnthropicProvider({
      ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
      ...(config.anthropicModel ? { model: config.anthropicModel } : {}),
      ...f,
    }),
  ];
}

/** First available provider in preference order, or null → degraded mode. */
export async function pickProvider(config: ProviderConfig = {}): Promise<LlmProvider | null> {
  for (const provider of createProviders(config)) {
    if (await provider.available()) return provider;
  }
  return null;
}
