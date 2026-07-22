import { describe, expect, it } from "vitest";
import { generateImageSchema } from "@/lib/validation/image";

/**
 * Seam B (pure/validation): the D1/D3 image generation input schema. The action
 * maps `tier` → the credit_rates action and derives the model/price server-side
 * — this schema only guards the client-supplied brand id, prompt, tier, aspect,
 * and variant count.
 */
describe("generateImageSchema", () => {
  const valid = {
    brandId: "00000000-0000-0000-0000-000000000000",
    prompt: "A cold brew on a sunlit café table",
  };

  it("applies defaults (standard tier, 1:1, 2 variants)", () => {
    const parsed = generateImageSchema.parse(valid);
    expect(parsed.tier).toBe("standard");
    expect(parsed.aspectRatio).toBe("1:1");
    expect(parsed.variantCount).toBe(2);
  });

  it("accepts each tier and aspect preset", () => {
    expect(generateImageSchema.parse({ ...valid, tier: "premium" }).tier).toBe(
      "premium",
    );
    for (const aspect of ["1:1", "4:5", "9:16", "16:9"]) {
      expect(
        generateImageSchema.parse({ ...valid, aspectRatio: aspect })
          .aspectRatio,
      ).toBe(aspect);
    }
  });

  it("rejects an unknown aspect ratio", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, aspectRatio: "3:2" }),
    ).toThrow();
  });

  it("rejects an unknown tier", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, tier: "ultra" }),
    ).toThrow();
  });

  it("bounds the variant count to 2–4", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, variantCount: 1 }),
    ).toThrow();
    expect(() =>
      generateImageSchema.parse({ ...valid, variantCount: 5 }),
    ).toThrow();
    expect(
      generateImageSchema.parse({ ...valid, variantCount: 4 }).variantCount,
    ).toBe(4);
  });

  it("trims and requires a non-empty prompt", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, prompt: "   " }),
    ).toThrow();
  });

  it("rejects a prompt over the max length", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, prompt: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects a non-uuid brand id", () => {
    expect(() =>
      generateImageSchema.parse({ ...valid, brandId: "not-a-uuid" }),
    ).toThrow();
  });

  it("accepts an optional platform", () => {
    expect(
      generateImageSchema.parse({ ...valid, platform: "instagram" }).platform,
    ).toBe("instagram");
  });
});
