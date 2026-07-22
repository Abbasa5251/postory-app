import { describe, expect, it } from "vitest";
import { PLATFORM_CONFIG } from "@/lib/platforms/config";
import { buildImagePrompt } from "@/server/domain/image-prompt";
import type { VoiceProfile } from "@/lib/validation/brands";

/**
 * D1 image prompt assembly (pure). No I/O, no model call — the OpenRouter image
 * transport is tested/build-verified separately.
 */

const voice: VoiceProfile = {
  tone: "warm, minimal, sunlit",
  bannedWords: ["cheap"],
  hashtags: ["coffee"],
  samplePosts: ["Rise and grind ☕"],
};

describe("buildImagePrompt", () => {
  it("keeps the user's description first", () => {
    const out = buildImagePrompt({
      prompt: "A cold brew on a café table",
      brandStyle: null,
    });
    expect(out.startsWith("A cold brew on a café table")).toBe(true);
  });

  it("weaves in only the brand tone (not banned words / hashtags / samples)", () => {
    const out = buildImagePrompt({ prompt: "A latte", brandStyle: voice });
    expect(out).toContain("warm, minimal, sunlit");
    // Copy-only voice fields must not leak into an image prompt.
    expect(out).not.toContain("cheap");
    expect(out).not.toContain("#coffee");
    expect(out).not.toContain("Rise and grind");
  });

  it("omits the brand aesthetic clause when there is no tone", () => {
    const out = buildImagePrompt({
      prompt: "A latte",
      brandStyle: { bannedWords: ["x"] },
    });
    expect(out).not.toContain("Brand aesthetic");
  });

  it("adds a platform framing hint when a platform is given", () => {
    const out = buildImagePrompt({
      prompt: "A latte",
      brandStyle: null,
      platform: "instagram",
    });
    expect(out).toContain(PLATFORM_CONFIG.instagram.label);
  });

  it("trims the description and always appends a quality nudge", () => {
    const out = buildImagePrompt({ prompt: "  A latte  ", brandStyle: null });
    expect(out).toContain("A latte");
    expect(out).not.toContain("  A latte  ");
    expect(out.toLowerCase()).toContain("high-quality");
  });
});
