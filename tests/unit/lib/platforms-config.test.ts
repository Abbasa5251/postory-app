import { describe, expect, it } from "vitest";
import {
  acceptedMimesForKind,
  assetFitsPlatform,
  getCharLimit,
  getMediaSpec,
  getPlatformConfig,
  IMAGE_ASPECT_PRESET_IDS,
  IMAGE_ASPECT_PRESETS,
  imagePresetsForPlatform,
  isPlatform,
  maxUploadBytesForKind,
  mediaKindForMime,
  PLATFORM_CONFIG,
  PLATFORM_LIST,
  PLATFORMS,
} from "@/lib/platforms/config";

/**
 * Seam B (pure/validation): the canonical platform config (AGENTS.md §4). Kept
 * in lockstep with the `social_accounts.platform` CHECK vocabulary (PRD §6).
 */
describe("platform config", () => {
  it("lists exactly the 6 launch platforms", () => {
    expect([...PLATFORMS]).toEqual([
      "instagram",
      "facebook",
      "tiktok",
      "linkedin",
      "threads",
      "youtube",
    ]);
  });

  it("every platform has a label and a Zernio slug", () => {
    for (const id of PLATFORMS) {
      const cfg = PLATFORM_CONFIG[id];
      expect(cfg.id).toBe(id);
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.zernioSlug.length).toBeGreaterThan(0);
    }
  });

  it("PLATFORM_LIST is ordered to match PLATFORMS", () => {
    expect(PLATFORM_LIST.map((c) => c.id)).toEqual([...PLATFORMS]);
  });

  it("isPlatform narrows only known platforms", () => {
    expect(isPlatform("instagram")).toBe(true);
    expect(isPlatform("twitter")).toBe(false);
    expect(isPlatform("")).toBe(false);
  });

  it("getPlatformConfig returns config for known, undefined for unknown", () => {
    expect(getPlatformConfig("tiktok")?.label).toBe("TikTok");
    expect(getPlatformConfig("myspace")).toBeUndefined();
  });

  it("every platform has a positive caption char limit (C1)", () => {
    for (const id of PLATFORMS) {
      expect(PLATFORM_CONFIG[id].charLimit).toBeGreaterThan(0);
      expect(getCharLimit(id)).toBe(PLATFORM_CONFIG[id].charLimit);
    }
    // PRD §6: Threads is the tightest (500).
    expect(getCharLimit("threads")).toBe(500);
  });
});

/**
 * C4 media specs (PRD §6). Per-platform rules drive the composer's advisory
 * warnings; the hard mime/size gate is server-enforced, aspect/duration at
 * publish.
 */
describe("platform media specs (C4)", () => {
  it("every platform declares media rules with a positive attachment cap", () => {
    for (const id of PLATFORMS) {
      const spec = getMediaSpec(id);
      expect(spec.maxAttachments).toBeGreaterThan(0);
      // A platform accepts at least one media kind.
      expect(spec.image !== null || spec.video !== null).toBe(true);
    }
  });

  it("video-only platforms (TikTok, YouTube Shorts) reject images", () => {
    expect(getMediaSpec("tiktok").image).toBeNull();
    expect(getMediaSpec("youtube").image).toBeNull();
    expect(getMediaSpec("tiktok").video).not.toBeNull();
    expect(getMediaSpec("youtube").video).not.toBeNull();
  });

  it("YouTube Shorts caps duration at 60s and requires 9:16", () => {
    const video = getMediaSpec("youtube").video!;
    expect(video.maxDurationSeconds).toBe(60);
    expect(video.aspectRatios).toContainEqual([9, 16]);
  });

  it("mediaKindForMime classifies image/video and rejects others", () => {
    expect(mediaKindForMime("image/png")).toBe("image");
    expect(mediaKindForMime("video/mp4")).toBe("video");
    expect(mediaKindForMime("application/pdf")).toBeNull();
  });

  it("upload-level allowlist is the union; max size is the largest platform's", () => {
    expect(acceptedMimesForKind("image")).toContain("image/jpeg");
    expect(acceptedMimesForKind("video")).toContain("video/mp4");
    expect(maxUploadBytesForKind("image")).toBeGreaterThan(0);
    // Video ceilings are larger than image ceilings across the board.
    expect(maxUploadBytesForKind("video")).toBeGreaterThan(
      maxUploadBytesForKind("image"),
    );
  });
});

describe("assetFitsPlatform (C4 advisory)", () => {
  it("passes a square jpeg on Instagram", () => {
    const fit = assetFitsPlatform("instagram", {
      kind: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1_000_000,
      width: 1080,
      height: 1080,
    });
    expect(fit.ok).toBe(true);
    expect(fit.warnings).toHaveLength(0);
  });

  it("rejects an image on a video-only platform", () => {
    const fit = assetFitsPlatform("tiktok", { kind: "image" });
    expect(fit.ok).toBe(false);
    expect(fit.warnings[0]).toMatch(/doesn't accept image/);
  });

  it("warns on a 16:9 video where 9:16 is required (YouTube)", () => {
    const fit = assetFitsPlatform("youtube", {
      kind: "video",
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
    });
    expect(fit.ok).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/9:16/);
  });

  it("warns on an over-duration Short", () => {
    const fit = assetFitsPlatform("youtube", {
      kind: "video",
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationSeconds: 120,
    });
    expect(fit.ok).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/60s or shorter/);
  });

  it("does not flag missing dimensions (probe may be unavailable)", () => {
    const fit = assetFitsPlatform("instagram", {
      kind: "image",
      mimeType: "image/jpeg",
    });
    expect(fit.ok).toBe(true);
  });
});

describe("image aspect presets (D1)", () => {
  it("exposes exactly the four PRD presets, ids in `${w}:${h}` form", () => {
    expect(IMAGE_ASPECT_PRESETS.map((p) => p.id)).toEqual([
      "1:1",
      "4:5",
      "9:16",
      "16:9",
    ]);
    expect(IMAGE_ASPECT_PRESET_IDS).toEqual(["1:1", "4:5", "9:16", "16:9"]);
  });

  it("recommends a platform's allowed image ratios (Instagram: 1:1, 4:5)", () => {
    expect(imagePresetsForPlatform("instagram")).toEqual(["1:1", "4:5"]);
  });

  it("recommends all presets when a platform accepts any ratio (Threads)", () => {
    expect(imagePresetsForPlatform("threads")).toEqual([
      "1:1",
      "4:5",
      "9:16",
      "16:9",
    ]);
  });

  it("recommends none for a video-only platform (TikTok has no image spec)", () => {
    expect(imagePresetsForPlatform("tiktok")).toEqual([]);
    expect(imagePresetsForPlatform("youtube")).toEqual([]);
  });
});
