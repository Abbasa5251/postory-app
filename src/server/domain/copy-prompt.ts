import "server-only";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";

/**
 * The brand-voice fields the prompt reads (B2). A structural subset of
 * VoiceProfile with all keys optional, so both the stored profile and the
 * Inngest event payload (also all-optional) assign without coupling this pure
 * module to the validation schema's exact inferred shape.
 */
export type VoiceGuidance = {
  tone?: string;
  bannedWords?: string[];
  hashtags?: string[];
  samplePosts?: string[];
};

/**
 * AI copy prompt assembly (C2) — pure, no I/O, unit-tested. Turns a brief +
 * brand voice + target platform into the messages sent to OpenRouter, and
 * splits the model's response back into caption variants. The service
 * (services/openrouter) only transports; the prompt engineering lives here so
 * it's testable and swappable independent of the wire format.
 *
 * One model call returns the whole variant batch (PRD §7.2 — a batch is 1
 * credit), so variants are separated by a sentinel line the model is told to
 * emit; `parseVariants` splits on it. C3 owns cross-platform adaptation — C2
 * generates for a single platform.
 */

/** The model separates variants with a line containing only this sentinel. */
export const VARIANT_SEPARATOR = "===";

/** Splitter: a whole line that is only `=` runs (>=3), tolerant of h-space. */
const SEPARATOR_LINE = /^[ \t]*={3,}[ \t]*$/m;

export type CopyPromptInput = {
  platform: Platform;
  brief: string;
  voiceProfile: VoiceGuidance | null;
  variantCount: number;
  /** Refine loop: an existing caption to rework (with `instruction`). */
  refineFrom?: string;
  instruction?: string;
};

function voiceGuidance(voice: VoiceGuidance | null): string {
  if (!voice) return "";
  const lines: string[] = [];
  if (voice.tone?.trim()) lines.push(`Brand tone: ${voice.tone.trim()}`);
  if (voice.hashtags?.length) {
    // Stored without '#' (B2); present them ready to use.
    lines.push(
      `Preferred hashtags to weave in where natural: ${voice.hashtags
        .map((h) => `#${h}`)
        .join(" ")}`,
    );
  }
  if (voice.bannedWords?.length) {
    lines.push(`Never use these words: ${voice.bannedWords.join(", ")}`);
  }
  if (voice.samplePosts?.length) {
    lines.push(
      `Sample posts that capture the brand's style:\n${voice.samplePosts
        .map((p) => `- ${p}`)
        .join("\n")}`,
    );
  }
  return lines.join("\n");
}

/** Build the system + user messages for a caption generation (or refine). */
export function buildCopyPrompt(input: CopyPromptInput): {
  system: string;
  prompt: string;
} {
  const config = PLATFORM_CONFIG[input.platform];
  const count = Math.max(1, input.variantCount);
  const voice = voiceGuidance(input.voiceProfile);

  const system = [
    `You are an expert social media copywriter creating ${config.label} captions.`,
    `Keep each caption within ${config.charLimit} characters and native to ${config.label}.`,
    voice,
    `Produce exactly ${count} distinct caption ${count === 1 ? "option" : "options"}.`,
    `Separate each option with a line containing only "${VARIANT_SEPARATOR}".`,
    `Output ONLY the captions and separators — no numbering, labels, quotes, or commentary.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt =
    input.refineFrom !== undefined
      ? [
          `Here is a caption to refine:`,
          input.refineFrom,
          ``,
          `Refinement request: ${input.instruction?.trim() || "Improve it while keeping the intent."}`,
          ``,
          `Original brief for context: ${input.brief}`,
        ].join("\n")
      : `Brief: ${input.brief}`;

  return { system, prompt };
}

/**
 * Split a model response into caption variants. Splits on the sentinel line,
 * trims, drops empties, and caps at `max` (defends against a chatty model).
 * Falls back to the whole trimmed text as a single variant if the model didn't
 * emit separators.
 */
export function parseVariants(text: string, max: number): string[] {
  const variants = text
    .split(SEPARATOR_LINE)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const result = variants.length > 0 ? variants : [text.trim()].filter(Boolean);
  return result.slice(0, Math.max(1, max));
}
