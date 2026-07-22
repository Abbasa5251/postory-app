import "server-only";
import type { Platform } from "@/lib/platforms/config";
import { PLATFORM_CONFIG } from "@/lib/platforms/config";
import type { VoiceGuidance } from "./copy-prompt";

/**
 * AI image prompt assembly (D1) — pure, no I/O, unit-tested. Turns the user's
 * description + brand style into the single text prompt sent to the OpenRouter
 * Image API. The service (services/openrouter) only transports; the prompt
 * engineering lives here so it's testable and swappable independent of the wire
 * format — mirroring `domain/copy-prompt`.
 *
 * Image models take one text prompt (no system/user split, no variant sentinel
 * — variant count is the wire `n`/fan-out, D2). Of the brand voice profile (B2)
 * only `tone` is a visual signal; banned words / hashtags / sample posts are
 * copy concepts and don't apply to imagery.
 */

export type ImagePromptInput = {
  /** The user's image description (composer seeds it from the caption). */
  prompt: string;
  /** Brand voice profile — only `tone` shapes the visual style. */
  brandStyle: VoiceGuidance | null;
  /** The platform the image is seeded for — a light framing hint (optional). */
  platform?: Platform;
};

/** Assemble the final image-generation prompt from the description + brand style. */
export function buildImagePrompt(input: ImagePromptInput): string {
  const parts: string[] = [input.prompt.trim()];

  const tone = input.brandStyle?.tone?.trim();
  if (tone) parts.push(`Brand aesthetic: ${tone}.`);

  if (input.platform) {
    parts.push(`Framed for a ${PLATFORM_CONFIG[input.platform].label} post.`);
  }

  // A quality nudge; kept generic so the description stays in control.
  parts.push(
    "High-quality, social-media-ready image with clean composition. Avoid watermarks and gibberish text.",
  );

  return parts.filter((p) => p.length > 0).join(" ");
}
