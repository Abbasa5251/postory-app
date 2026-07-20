import { describe, expect, it } from "vitest";
import {
  VARIANT_SEPARATOR,
  buildCopyPrompt,
  parseVariants,
} from "@/server/domain/copy-prompt";
import { PLATFORM_CONFIG } from "@/lib/platforms/config";
import type { VoiceProfile } from "@/lib/validation/brands";

/**
 * C2 prompt assembly + variant parsing (pure). No I/O, no model call — the
 * OpenRouter transport is tested separately.
 */

const voice: VoiceProfile = {
  tone: "playful and bold",
  bannedWords: ["cheap", "guys"],
  hashtags: ["coffee", "morningritual"],
  samplePosts: ["Rise and grind ☕"],
};

describe("buildCopyPrompt", () => {
  it("names the platform, its char limit, and the exact variant count", () => {
    const { system } = buildCopyPrompt({
      platform: "instagram",
      brief: "Launch our new cold brew",
      voiceProfile: null,
      variantCount: 3,
    });
    expect(system).toContain(PLATFORM_CONFIG.instagram.label);
    expect(system).toContain(String(PLATFORM_CONFIG.instagram.charLimit));
    expect(system).toContain("exactly 3");
    expect(system).toContain(VARIANT_SEPARATOR);
  });

  it("folds in brand voice: tone, hashtags (with #), banned words, samples", () => {
    const { system } = buildCopyPrompt({
      platform: "instagram",
      brief: "Launch",
      voiceProfile: voice,
      variantCount: 2,
    });
    expect(system).toContain("playful and bold");
    expect(system).toContain("#coffee");
    expect(system).toContain("#morningritual");
    expect(system).toContain("cheap");
    expect(system).toContain("Rise and grind");
  });

  it("puts the brief in the user prompt when not refining", () => {
    const { prompt } = buildCopyPrompt({
      platform: "threads",
      brief: "Weekend sale",
      voiceProfile: null,
      variantCount: 1,
    });
    expect(prompt).toContain("Weekend sale");
    expect(prompt).not.toContain("refine");
  });

  it("builds a refine prompt from a prior caption + instruction", () => {
    const { prompt } = buildCopyPrompt({
      platform: "instagram",
      brief: "Launch",
      voiceProfile: null,
      variantCount: 1,
      refineFrom: "Old caption here",
      instruction: "Make it punchier",
    });
    expect(prompt).toContain("Old caption here");
    expect(prompt).toContain("Make it punchier");
  });

  it("uses the singular 'option' for a single variant", () => {
    const { system } = buildCopyPrompt({
      platform: "instagram",
      brief: "x",
      voiceProfile: null,
      variantCount: 1,
    });
    expect(system).toContain("exactly 1 distinct caption option");
    expect(system).not.toContain("caption options");
  });
});

describe("parseVariants", () => {
  it("splits on the sentinel line and trims", () => {
    const text = "First caption\n===\nSecond caption\n===\nThird caption";
    expect(parseVariants(text, 3)).toEqual([
      "First caption",
      "Second caption",
      "Third caption",
    ]);
  });

  it("tolerates extra '=' and surrounding whitespace on the separator", () => {
    const text = "One\n  =====  \nTwo";
    expect(parseVariants(text, 5)).toEqual(["One", "Two"]);
  });

  it("drops empty segments", () => {
    const text = "Only one\n===\n\n===\n   ";
    expect(parseVariants(text, 5)).toEqual(["Only one"]);
  });

  it("caps at max even if the model over-produces", () => {
    const text = "a\n===\nb\n===\nc\n===\nd";
    expect(parseVariants(text, 2)).toEqual(["a", "b"]);
  });

  it("falls back to the whole text when no separators are present", () => {
    expect(parseVariants("just one block", 3)).toEqual(["just one block"]);
  });

  it("returns nothing for empty/whitespace-only output", () => {
    expect(parseVariants("   ", 3)).toEqual([]);
  });
});
