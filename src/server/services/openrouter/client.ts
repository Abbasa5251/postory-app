import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, streamText } from "ai";
import { env } from "@/lib/env/server";
import {
  acceptedMimesForKind,
  maxUploadBytesForKind,
} from "@/lib/platforms/config";
import { OpenRouterError } from "./errors";

/**
 * OpenRouter service (ADR-012) — the ONLY module that speaks the OpenRouter /
 * AI SDK wire format, preserving a direct-provider escape hatch. Text is
 * OpenAI-compatible chat completions via the AI SDK OpenRouter provider; images
 * (D2) use the AI SDK image API over the same provider (`imageModel`), returning
 * base64/bytes the job decodes and stores in R2.
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

export type GenerateImagesInput = {
  /** OpenRouter image model id, from credit_rates (never hardcoded). */
  modelId: string;
  /** The final prompt (domain/image-prompt assembles it from caption + style). */
  prompt: string;
  /** Output aspect ratio as `${w}:${h}` (an IMAGE_ASPECT_PRESETS id). */
  aspectRatio: `${number}:${number}`;
  /** How many images to generate. */
  n: number;
  /** Aborts the upstream request (job cancellation / timeout). */
  signal?: AbortSignal;
};

/** One generated image, decoded and ready to store in R2. */
export type GeneratedImage = {
  bytes: Uint8Array;
  /** IANA media type reported by the model (e.g. `image/png`). */
  mediaType: string;
};

/**
 * Generate images via the OpenRouter Image API (D2, ADR-012). Returns the raw
 * decoded bytes + media type for each image; the caller (the Inngest job) owns
 * storing them in R2 and recording the media_assets row. OpenRouter's image
 * models cap `n` per request at 1, so the job fans out one call per variant and
 * passes `n: 1` — this keeps per-image failures isolated and refundable
 * (failed generations are unbilled, ADR-012 → refund the reservation).
 *
 * `maxRetries: 0` — image generation is billed and NOT deduplicated by
 * OpenRouter, so a silent SDK retry after a lost-but-succeeded response would
 * double-generate/double-bill. A transient failure instead surfaces to the job,
 * which fails that one variant and refunds it (partial success). Job-level
 * retry-safety is separately guaranteed by the memoized per-variant step.
 *
 * Each returned image is validated against the same media allowlist + size cap
 * as an upload (`platforms/config`), so unvalidated provider output never
 * reaches R2. Errors (auth / rate-limit / upstream / content filter / an
 * unsupported or oversized image) throw; the job's refund path handles them.
 */
export async function generateImages(
  input: GenerateImagesInput,
): Promise<GeneratedImage[]> {
  const result = await generateImage({
    model: getProvider().imageModel(input.modelId),
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    n: input.n,
    maxRetries: 0,
    abortSignal: input.signal,
  });

  const allowedMimes = acceptedMimesForKind("image");
  const maxBytes = maxUploadBytesForKind("image");
  return result.images.map((image) => {
    if (!allowedMimes.includes(image.mediaType)) {
      throw new OpenRouterError(
        `Generated image has an unsupported media type: ${image.mediaType}`,
      );
    }
    if (image.uint8Array.byteLength > maxBytes) {
      throw new OpenRouterError(
        `Generated image exceeds the ${maxBytes}-byte limit`,
      );
    }
    return { bytes: image.uint8Array, mediaType: image.mediaType };
  });
}
