import { describe, expect, it } from "vitest";
import { PLATFORM_CONFIG } from "@/lib/platforms/config";
import {
  emptyPostContent,
  postContentSchema,
  saveDraftSchema,
} from "@/lib/validation/posts";

/**
 * Seam B (pure/validation): the composer content schema (C1) — the shape stored
 * in post_versions.content. Per-platform caption limits come from the single
 * source of truth (PLATFORM_CONFIG), not this test.
 */
describe("postContentSchema", () => {
  it("accepts a valid single-platform draft", () => {
    const parsed = postContentSchema.parse({
      targets: ["instagram"],
      variants: { instagram: { caption: "hello" } },
    });
    expect(parsed.targets).toEqual(["instagram"]);
    expect(parsed.variants.instagram?.caption).toBe("hello");
  });

  it("allows an empty caption (a draft may be incomplete)", () => {
    expect(() =>
      postContentSchema.parse({
        targets: ["facebook"],
        variants: { facebook: { caption: "" } },
      }),
    ).not.toThrow();
  });

  it("rejects zero targets", () => {
    const result = postContentSchema.safeParse({
      targets: [],
      variants: {},
    });
    expect(result.success).toBe(false);
  });

  it("dedupes repeated targets", () => {
    const parsed = postContentSchema.parse({
      targets: ["instagram", "instagram"],
      variants: { instagram: { caption: "x" } },
    });
    expect(parsed.targets).toEqual(["instagram"]);
  });

  it("rejects a target with no caption variant", () => {
    const result = postContentSchema.safeParse({
      targets: ["instagram", "threads"],
      variants: { instagram: { caption: "x" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a caption over the platform's char limit (per-platform)", () => {
    // Threads (500) is tightest; a 500-char caption is fine on Instagram (2200).
    const caption = "a".repeat(PLATFORM_CONFIG.threads.charLimit + 1);
    const overThreads = postContentSchema.safeParse({
      targets: ["threads"],
      variants: { threads: { caption } },
    });
    expect(overThreads.success).toBe(false);

    const okOnInstagram = postContentSchema.safeParse({
      targets: ["instagram"],
      variants: { instagram: { caption } },
    });
    expect(okOnInstagram.success).toBe(true);
  });

  it("accepts a caption exactly at the platform's char limit (boundary)", () => {
    const caption = "a".repeat(PLATFORM_CONFIG.threads.charLimit);
    const atLimit = postContentSchema.safeParse({
      targets: ["threads"],
      variants: { threads: { caption } },
    });
    expect(atLimit.success).toBe(true);
  });
});

describe("saveDraftSchema", () => {
  const brandId = "0193f0e0-0000-7000-8000-000000000000";

  it("accepts a create (no postId) with valid content", () => {
    const parsed = saveDraftSchema.parse({
      brandId,
      content: {
        targets: ["linkedin"],
        variants: { linkedin: { caption: "hi" } },
      },
    });
    expect(parsed.postId).toBeUndefined();
    expect(parsed.brandId).toBe(brandId);
  });

  it("accepts an edit (postId present)", () => {
    const postId = "0193f0e0-0000-7000-8000-000000000001";
    const parsed = saveDraftSchema.parse({
      brandId,
      postId,
      content: {
        targets: ["youtube"],
        variants: { youtube: { caption: "hi" } },
      },
    });
    expect(parsed.postId).toBe(postId);
  });

  it("rejects a non-uuid brandId", () => {
    const result = saveDraftSchema.safeParse({
      brandId: "not-a-uuid",
      content: { targets: ["tiktok"], variants: { tiktok: { caption: "" } } },
    });
    expect(result.success).toBe(false);
  });
});

describe("emptyPostContent", () => {
  it("is a valid starting point with no targets", () => {
    expect(emptyPostContent()).toEqual({ targets: [], variants: {} });
  });
});
