import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText } from "ai";
import { env } from "@/lib/env/server";
import { OpenRouterError } from "./errors";

/**
 * OpenRouter service (ADR-012) — the ONLY module that speaks the OpenRouter /
 * AI SDK wire format, preserving a direct-provider escape hatch. Text is
 * OpenAI-compatible chat completions via the AI SDK OpenRouter provider; images
 * (D2) will use the dedicated Image API here too.
 *
 * The provider is built lazily on first use (like getRedis / the Zernio
 * client), so a missing key never breaks builds or unit tests — only a real
 * generation call. Model ids come from the credit_rates config (dal/credits),
 * never hardcoded here.
 */
let provider: ReturnType<typeof createOpenRouter> | null = null;

function getProvider() {
  if (!provider) {
    if (!env.OPENROUTER_API_KEY) {
      throw new OpenRouterError("OPENROUTER_API_KEY is not configured");
    }
    provider = createOpenRouter({
      apiKey: env.OPENROUTER_API_KEY,
      // App attribution on the OpenRouter dashboard (§ provider settings).
      appName: "POSTORY",
      appUrl: env.BETTER_AUTH_URL,
    });
  }
  return provider;
}

export type StreamCaptionInput = {
  /** OpenRouter chat model id, from credit_rates (never hardcoded). */
  modelId: string;
  system: string;
  prompt: string;
  /** Aborts the upstream request (job cancellation / timeout). */
  signal?: AbortSignal;
};

export type StreamCaptionResult = {
  /** Incremental text deltas — the job forwards these to the realtime channel. */
  textStream: AsyncIterable<string>;
  /** Resolves to the full generated text once the stream completes. */
  text: PromiseLike<string>;
};

/**
 * Stream a chat completion for caption generation. Returns the AI SDK stream
 * handles; the caller (the Inngest job) owns forwarding deltas to realtime and
 * splitting the final text into variants (domain/copy-prompt). Higher
 * temperature for variant diversity. Errors surface while consuming the stream
 * (auth / rate-limit / upstream) and are handled by the job's refund path.
 */
export function streamCaption(input: StreamCaptionInput): StreamCaptionResult {
  const result = streamText({
    model: getProvider().chat(input.modelId),
    system: input.system,
    prompt: input.prompt,
    temperature: 0.9,
    maxOutputTokens: 1500,
    abortSignal: input.signal,
  });
  return { textStream: result.textStream, text: result.text };
}
