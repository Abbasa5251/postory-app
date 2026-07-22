/**
 * Preview-chrome config + pure helpers for the C5 feed-accurate preview cards.
 * Isomorphic (lib/) — imported by the client preview component and unit-tested
 * directly. Platform identity/limits stay in `config.ts` (the single source, §4);
 * this file adds only how each platform's *preview* is laid out (a presentational
 * choice, not a validation rule), so it lives beside the config rather than
 * duplicating it.
 */

import type { Platform } from "./config";

/**
 * Feed = a stacked card (avatar/header, caption, media, engagement row) like
 * Instagram/Facebook/LinkedIn/Threads. Vertical = a full-bleed 9:16 frame with a
 * right-rail action stack and a bottom caption overlay, like TikTok / YouTube
 * Shorts (the video-first platforms C5 was raised for).
 */
export type PreviewLayout = "feed" | "vertical";

export type PreviewChrome = {
  layout: PreviewLayout;
  /** CSS `aspect-ratio` value for the media frame, e.g. "1 / 1", "9 / 16". */
  mediaAspect: string;
  /** Feed only: caption above the media (FB/LinkedIn/Threads) vs below (Instagram). */
  captionFirst: boolean;
  /** Show a secondary subtitle line under the name (LinkedIn headline). */
  showHeadline: boolean;
  /**
   * A feed platform that also has a distinct 9:16 vertical video format (a Reel):
   * when the attached media is a **video**, the preview switches to the vertical
   * (Reel) chrome instead of the feed card. Instagram + Facebook have Reels;
   * LinkedIn/Threads render video inline in the feed card. `false` for the
   * always-vertical video platforms (TikTok / YouTube Shorts).
   */
  reelsOnVideo: boolean;
};

/**
 * Representative preview layout per platform. The media aspect is the shape the
 * preview frames media into (object-cover) — a preview approximation, seeded from
 * the platform's primary format in `config.ts` (Instagram 1:1 feed, LinkedIn/FB
 * landscape, TikTok/YouTube 9:16). Re-verify against the live feed layouts at the
 * phase gate, same discipline as the media specs.
 */
export const PREVIEW_CHROME: Record<Platform, PreviewChrome> = {
  instagram: {
    layout: "feed",
    mediaAspect: "1 / 1",
    captionFirst: false,
    showHeadline: false,
    reelsOnVideo: true,
  },
  facebook: {
    layout: "feed",
    mediaAspect: "1 / 1",
    captionFirst: true,
    showHeadline: true,
    reelsOnVideo: true,
  },
  tiktok: {
    layout: "vertical",
    mediaAspect: "9 / 16",
    captionFirst: false,
    showHeadline: false,
    reelsOnVideo: false,
  },
  linkedin: {
    layout: "feed",
    mediaAspect: "16 / 9",
    captionFirst: true,
    showHeadline: true,
    reelsOnVideo: false,
  },
  threads: {
    layout: "feed",
    mediaAspect: "1 / 1",
    captionFirst: true,
    showHeadline: false,
    reelsOnVideo: false,
  },
  youtube: {
    layout: "vertical",
    mediaAspect: "9 / 16",
    captionFirst: false,
    showHeadline: false,
    reelsOnVideo: false,
  },
};

/** Static preview chrome for a platform (its feed/base layout). */
export function getPreviewChrome(platform: Platform): PreviewChrome {
  return PREVIEW_CHROME[platform];
}

/**
 * The effective preview layout given the attached media. Always-vertical
 * platforms (TikTok / YouTube Shorts) stay vertical. A Reels-capable feed
 * platform (Instagram / Facebook) shows the 9:16 vertical (Reel) chrome ONLY for
 * a **single video** — two+ items is a carousel (a feed card), even a mixed
 * image+video one, so the reel switch requires `mediaCount === 1`. Everything
 * else stays a feed card.
 */
export function resolvePreviewLayout(
  platform: Platform,
  isVideoHero: boolean,
  mediaCount: number,
): PreviewLayout {
  const chrome = PREVIEW_CHROME[platform];
  if (chrome.layout === "vertical") return "vertical";
  if (chrome.reelsOnVideo && isVideoHero && mediaCount === 1) return "vertical";
  return "feed";
}

/**
 * A short format label for the preview eyebrow (`Preview · Instagram · Reel`),
 * or null when the base format needs no qualifier.
 */
export function previewFormatLabel(
  platform: Platform,
  layout: PreviewLayout,
): string | null {
  if (layout !== "vertical") return null;
  if (platform === "youtube") return "Shorts";
  if (platform === "instagram" || platform === "facebook") return "Reel";
  return null; // TikTok is inherently vertical video — no qualifier needed.
}

/**
 * Resolve an ordered list of media ids to their assets against a library, in the
 * id order and skipping any id not in the library (a stale/foreign ref). Pure and
 * generic so it's unit-testable with plain objects (mirrors the `Map`-over-library
 * pattern the composer's MediaCard uses).
 */
export function resolveMediaAssets<T extends { id: string }>(
  ids: readonly string[] | undefined,
  library: readonly T[],
): T[] {
  if (!ids?.length) return [];
  const byId = new Map(library.map((asset) => [asset.id, asset]));
  const resolved: T[] = [];
  for (const id of ids) {
    const asset = byId.get(id);
    if (asset) resolved.push(asset);
  }
  return resolved;
}

/**
 * Truncate a caption to `max` characters at a word boundary for a feed-accurate
 * "…more" preview (real feeds collapse long captions). Pure. `truncated` tells
 * the caller whether to render the "more" affordance.
 */
export function truncateCaption(
  caption: string,
  max: number,
): { text: string; truncated: boolean } {
  if (caption.length <= max) return { text: caption, truncated: false };
  const slice = caption.slice(0, max);
  // Prefer cutting at the last space so we don't split a word; fall back to the
  // hard slice if there's no space in range.
  const lastSpace = slice.lastIndexOf(" ");
  const text = (
    lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice
  ).trimEnd();
  return { text, truncated: true };
}
