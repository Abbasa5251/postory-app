import { describe, expect, it } from "vitest";
import { createUploadSchema, recordUploadSchema } from "@/lib/validation/media";

/**
 * Seam B (pure/validation): media upload input schemas (C4). Reads the
 * upload-level allowlist + size ceilings from platforms/config (single source),
 * never hardcoded here.
 */
describe("createUploadSchema", () => {
  const valid = {
    brandId: "0193f0e0-0000-7000-8000-000000000000",
    kind: "image" as const,
    mimeType: "image/jpeg",
    sizeBytes: 1_000_000,
    width: 1080,
    height: 1080,
  };

  it("accepts a valid image upload request", () => {
    expect(createUploadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unsupported mime type for the kind", () => {
    const result = createUploadSchema.safeParse({
      ...valid,
      mimeType: "image/gif",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file larger than the kind's ceiling", () => {
    const result = createUploadSchema.safeParse({
      ...valid,
      sizeBytes: 5_000 * 1024 * 1024, // 5 GB
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed brand id", () => {
    const result = createUploadSchema.safeParse({ ...valid, brandId: "nope" });
    expect(result.success).toBe(false);
  });

  it("allows optional probed dimensions to be absent", () => {
    const noDims = {
      brandId: valid.brandId,
      kind: valid.kind,
      mimeType: valid.mimeType,
      sizeBytes: valid.sizeBytes,
    };
    expect(createUploadSchema.safeParse(noDims).success).toBe(true);
  });
});

describe("recordUploadSchema", () => {
  it("accepts a valid record request", () => {
    const result = recordUploadSchema.safeParse({
      brandId: "0193f0e0-0000-7000-8000-000000000000",
      r2Key: "org/o/brand/b/abc.mp4",
      kind: "video",
      width: 1080,
      height: 1920,
      durationSeconds: 30,
    });
    expect(result.success).toBe(true);
  });

  it("requires an r2Key", () => {
    const result = recordUploadSchema.safeParse({
      brandId: "0193f0e0-0000-7000-8000-000000000000",
      r2Key: "",
      kind: "image",
    });
    expect(result.success).toBe(false);
  });
});
