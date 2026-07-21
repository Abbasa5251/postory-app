import { describe, expect, it } from "vitest";
import { adaptCopySchema } from "@/lib/validation/copy";

/**
 * Seam B (pure/validation): the C3 cross-platform adaptation input schema.
 * The action derives model/credits from credit_rates server-side — this schema
 * only guards the client-supplied brand id, target platforms, and master caption.
 */
describe("adaptCopySchema", () => {
  const valid = {
    brandId: "00000000-0000-0000-0000-000000000000",
    platforms: ["instagram", "linkedin"],
    sourceCaption: "Our cold brew launches Friday.",
  };

  it("accepts a valid multi-platform adaptation request", () => {
    const parsed = adaptCopySchema.parse(valid);
    expect(parsed.platforms).toEqual(["instagram", "linkedin"]);
    expect(parsed.sourceCaption).toBe("Our cold brew launches Friday.");
  });

  it("dedupes repeated target platforms", () => {
    const parsed = adaptCopySchema.parse({
      ...valid,
      platforms: ["instagram", "instagram", "linkedin"],
    });
    expect(parsed.platforms).toEqual(["instagram", "linkedin"]);
  });

  it("requires at least one target platform", () => {
    expect(() => adaptCopySchema.parse({ ...valid, platforms: [] })).toThrow();
  });

  it("rejects an unknown platform", () => {
    expect(() =>
      adaptCopySchema.parse({ ...valid, platforms: ["myspace"] }),
    ).toThrow();
  });

  it("trims and requires a non-empty source caption", () => {
    expect(() =>
      adaptCopySchema.parse({ ...valid, sourceCaption: "   " }),
    ).toThrow();
  });

  it("rejects a source caption over the max length", () => {
    expect(() =>
      adaptCopySchema.parse({ ...valid, sourceCaption: "x".repeat(5001) }),
    ).toThrow();
  });

  it("rejects a non-uuid brand id", () => {
    expect(() =>
      adaptCopySchema.parse({ ...valid, brandId: "not-a-uuid" }),
    ).toThrow();
  });
});
