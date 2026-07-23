import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, generateText, Output, streamText } from "ai";
import * as z from "zod";
import { env } from "@/lib/env/server";
import {
  acceptedMimesForKind,
  maxUploadBytesForKind,
} from "@/lib/platforms/config";
import { MODERATION_CATEGORIES } from "@/server/domain/moderation";
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
  /**
   * OpenRouter's generation id — the response body `id` (the `gen-…` id chat
   * completions return), falling back to the `x-request-id` header. Resolves
   * once the stream completes; persisted on the generation job for billing
   * cross-reference. Never rejects (→ `null`), so an unconsumed value in an
   * error path can't surface as an unhandled rejection.
   */
  providerId: Promise<string | null>;
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
  return {
    textStream: result.textStream,
    text: result.text,
    providerId: Promise.resolve(result.response)
      .then((r) => r.id ?? r.headers?.["x-request-id"] ?? null)
      .catch(() => null),
  };
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
  /**
   * OpenRouter's request identifier for this generation (the `x-request-id`
   * response header) — persisted on the generation job so a charge can be
   * cross-referenced to OpenRouter's logs. `null` if the header is absent.
   */
  providerId: string | null;
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

  // OpenRouter's request identifier (fetch-lowercased header) — persisted on
  // the job for billing cross-reference. One response per call (we send n: 1).
  const headers = result.responses?.[0]?.headers ?? {};
  const providerId = headers["x-request-id"] ?? null;

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
    return { bytes: image.uint8Array, mediaType: image.mediaType, providerId };
  });
}

/**
 * The judge's structured verdict (D5). `flagged` drives the block decision;
 * `categories` is informational for the audit log (kept as free strings, not a
 * hard enum, so an off-taxonomy category from the model can't fail validation
 * and force a retry — the domain `verdictFromJudge` normalizes them). The
 * expected category names are surfaced to the model via the system prompt.
 */
const moderationVerdictSchema = z.object({
  flagged: z
    .boolean()
    .describe("true if the content violates the safety policy"),
  categories: z
    .array(z.string())
    .describe("the violated safety categories (empty if not flagged)"),
});
export type ModerationVerdict = z.infer<typeof moderationVerdictSchema>;

const MODERATION_SYSTEM = `You are a strict content-safety classifier for a brand-marketing tool that publishes to public social platforms. Decide whether the provided content violates the safety policy.

Flag content that contains any of these categories: ${MODERATION_CATEGORIES.join(", ")}. In particular, ALWAYS flag any sexual content involving minors, non-consensual sexual content, graphic gore, hateful or harassing content targeting protected groups, instructions for weapons/mass-casualty attacks, or other clearly unsafe-for-brand material.

Do NOT flag ordinary marketing imagery or copy, including tasteful product/lifestyle shots, mild edginess, or brand slang. When unsure but the content is plausibly brand-safe, do not flag. Return only the structured verdict.`;

export type ModerateImageInput = {
  /** OpenRouter chat model id with vision, from credit_rates (never hardcoded). */
  modelId: string;
  /** Raw generated image bytes (before they are served to anyone). */
  bytes: Uint8Array;
  /** IANA media type of the image (e.g. `image/png`). */
  mediaType: string;
  /** Aborts the upstream request (job cancellation / timeout). */
  signal?: AbortSignal;
};

/**
 * Classify a generated image for safety (D5) via a vision-capable chat model
 * (OpenRouter has no dedicated moderation endpoint — verified §3, 2026-07-23).
 * `maxRetries: 0`: a moderation call is cheap and the JOB owns retry-safety (the
 * moderate step is memoized separately from generation, so a retry re-moderates
 * without re-generating/re-billing). The caller (the Inngest job) is fail-closed:
 * if this throws, it treats the image as blocked, never surfaced un-moderated.
 */
export async function moderateImage(
  input: ModerateImageInput,
): Promise<ModerationVerdict> {
  const { output } = await generateText({
    model: getProvider().chat(input.modelId),
    // generateObject is deprecated in ai@7 → structured output via generateText
    // + Output.object (same validated verdict object).
    output: Output.object({
      schema: moderationVerdictSchema,
      name: "moderation_verdict",
    }),
    system: MODERATION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Classify this generated image." },
          { type: "image", image: input.bytes, mediaType: input.mediaType },
        ],
      },
    ],
    maxRetries: 0,
    abortSignal: input.signal,
  });
  return output;
}

export type ModerateTextInput = {
  /** OpenRouter chat model id, from credit_rates (never hardcoded). */
  modelId: string;
  /** The generated caption/text to classify. */
  text: string;
  /** Aborts the upstream request (job cancellation / timeout). */
  signal?: AbortSignal;
};

/**
 * Classify generated caption text for safety (D5). Same judge + policy as
 * `moderateImage`; text-only input. `maxRetries: 0` and fail-closed at the call
 * site, as above.
 */
export async function moderateText(
  input: ModerateTextInput,
): Promise<ModerationVerdict> {
  const { output } = await generateText({
    model: getProvider().chat(input.modelId),
    // generateObject is deprecated in ai@7 → structured output via generateText
    // + Output.object (same validated verdict object).
    output: Output.object({
      schema: moderationVerdictSchema,
      name: "moderation_verdict",
    }),
    system: MODERATION_SYSTEM,
    prompt: `Classify this social-media caption:\n\n${input.text}`,
    maxRetries: 0,
    abortSignal: input.signal,
  });
  return output;
}
