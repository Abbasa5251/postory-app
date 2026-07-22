import { describe, expect, it } from "vitest";
import { buildMediaKey, extForMediaType } from "@/server/services/storage";

/**
 * The ADR-007 R2/MinIO key layout (C4) — the single place media keys are built.
 * Keys are always org/brand-prefixed from ctx ids, never client input.
 */
describe("buildMediaKey", () => {
  it("prefixes org/{orgId}/brand/{brandId}/ with a random name + extension", () => {
    const key = buildMediaKey("org_1", "brand_1", "jpg");
    expect(key).toMatch(/^org\/org_1\/brand\/brand_1\/[0-9a-f-]{36}\.jpg$/);
  });

  it("sanitizes the extension", () => {
    const key = buildMediaKey("o", "b", "MP4");
    expect(key.endsWith(".mp4")).toBe(true);
    const dirty = buildMediaKey("o", "b", "../evil");
    expect(dirty).toMatch(/\.evil$/);
    expect(dirty).not.toContain("..");
  });

  it("produces distinct keys for repeated calls", () => {
    expect(buildMediaKey("o", "b", "png")).not.toBe(
      buildMediaKey("o", "b", "png"),
    );
  });
});

/**
 * Media-type → extension mapping for the D2 server-side PUT key (generated
 * images arrive as bytes + a media type from OpenRouter).
 */
describe("extForMediaType", () => {
  it("maps the supported image media types", () => {
    expect(extForMediaType("image/png")).toBe("png");
    expect(extForMediaType("image/jpeg")).toBe("jpg");
    expect(extForMediaType("image/webp")).toBe("webp");
  });

  it("falls back to 'bin' for an unknown media type", () => {
    expect(extForMediaType("image/gif")).toBe("bin");
    expect(extForMediaType("")).toBe("bin");
  });
});
