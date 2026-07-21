import { describe, expect, it } from "vitest";
import { PLATFORMS } from "@/lib/platforms/config";
import {
  getPreviewChrome,
  PREVIEW_CHROME,
  previewFormatLabel,
  resolveMediaAssets,
  resolvePreviewLayout,
  truncateCaption,
} from "@/lib/platforms/preview";

/**
 * Seam B (pure): the C5 preview-chrome config + helpers. Presentational, but the
 * media-id resolution + caption truncation are pure logic worth pinning.
 */
describe("preview chrome", () => {
  it("has chrome for every launch platform", () => {
    for (const p of PLATFORMS) {
      const chrome = getPreviewChrome(p);
      expect(chrome).toBe(PREVIEW_CHROME[p]);
      expect(chrome.mediaAspect).toMatch(/^\d+ \/ \d+$/);
    }
  });

  it("frames the video-first platforms as 9:16 vertical", () => {
    for (const p of ["tiktok", "youtube"] as const) {
      expect(getPreviewChrome(p).layout).toBe("vertical");
      expect(getPreviewChrome(p).mediaAspect).toBe("9 / 16");
    }
  });

  it("frames Instagram as a 1:1 media-below-header feed card", () => {
    const chrome = getPreviewChrome("instagram");
    expect(chrome.layout).toBe("feed");
    expect(chrome.mediaAspect).toBe("1 / 1");
    expect(chrome.captionFirst).toBe(false);
  });
});

describe("resolvePreviewLayout (media-aware)", () => {
  it("keeps Instagram/Facebook as a feed card for images/text", () => {
    expect(resolvePreviewLayout("instagram", false)).toBe("feed");
    expect(resolvePreviewLayout("facebook", false)).toBe("feed");
  });

  it("switches Instagram/Facebook to vertical (Reel) when the media is a video", () => {
    expect(resolvePreviewLayout("instagram", true)).toBe("vertical");
    expect(resolvePreviewLayout("facebook", true)).toBe("vertical");
  });

  it("keeps LinkedIn/Threads as a feed card even with a video (inline, no Reel)", () => {
    expect(resolvePreviewLayout("linkedin", true)).toBe("feed");
    expect(resolvePreviewLayout("threads", true)).toBe("feed");
  });

  it("keeps TikTok/YouTube vertical regardless of media", () => {
    for (const p of ["tiktok", "youtube"] as const) {
      expect(resolvePreviewLayout(p, false)).toBe("vertical");
      expect(resolvePreviewLayout(p, true)).toBe("vertical");
    }
  });
});

describe("previewFormatLabel", () => {
  it("labels vertical Instagram/Facebook as Reel and YouTube as Shorts", () => {
    expect(previewFormatLabel("instagram", "vertical")).toBe("Reel");
    expect(previewFormatLabel("facebook", "vertical")).toBe("Reel");
    expect(previewFormatLabel("youtube", "vertical")).toBe("Shorts");
  });

  it("adds no qualifier for TikTok (inherently vertical) or any feed layout", () => {
    expect(previewFormatLabel("tiktok", "vertical")).toBeNull();
    expect(previewFormatLabel("instagram", "feed")).toBeNull();
  });
});

describe("resolveMediaAssets", () => {
  const library = [
    { id: "a", url: "/a" },
    { id: "b", url: "/b" },
    { id: "c", url: "/c" },
  ];

  it("returns [] for undefined / empty ids", () => {
    expect(resolveMediaAssets(undefined, library)).toEqual([]);
    expect(resolveMediaAssets([], library)).toEqual([]);
  });

  it("resolves in id order and preserves duplicates from the id list", () => {
    expect(resolveMediaAssets(["b", "a"], library)).toEqual([
      { id: "b", url: "/b" },
      { id: "a", url: "/a" },
    ]);
  });

  it("skips ids not present in the library (stale/foreign refs)", () => {
    expect(resolveMediaAssets(["a", "missing", "c"], library)).toEqual([
      { id: "a", url: "/a" },
      { id: "c", url: "/c" },
    ]);
  });
});

describe("truncateCaption", () => {
  it("returns the caption untouched when within the limit", () => {
    expect(truncateCaption("short", 20)).toEqual({
      text: "short",
      truncated: false,
    });
  });

  it("truncates at a word boundary and flags truncation", () => {
    const caption = "the quick brown fox jumps over the lazy dog";
    const { text, truncated } = truncateCaption(caption, 20);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(20);
    expect(caption.startsWith(text)).toBe(true);
    // cut on a space, not mid-word
    expect(text.endsWith(" ")).toBe(false);
    expect(text).toBe("the quick brown fox");
  });

  it("hard-cuts when there is no early space to break on", () => {
    const caption = "a".repeat(50);
    const { text, truncated } = truncateCaption(caption, 10);
    expect(truncated).toBe(true);
    expect(text).toBe("a".repeat(10));
  });
});
