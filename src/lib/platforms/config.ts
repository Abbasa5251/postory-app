/**
 * Platform configuration — the single source of truth for the launch social
 * networks (AGENTS.md §4). Composer validation, preview cards, pre-publish
 * checks, and the B3 connect flow all read from here; adding a platform
 * post-launch is a config edit, not an architecture change (PRD §6).
 *
 * Isomorphic-safe (lib/): no server imports, no secrets. The per-platform
 * media/character rules (PRD §6) attach to these entries as later epics need
 * them — B3 needed only identity + Zernio slug + label; C1 adds the caption
 * `charLimit` (composer counter + validation). Media specs and aspect ratios
 * (PRD §6) still attach later, with C4/C5.
 */

/** The 6 launch platforms (D3). `youtube` covers Shorts — a format, not a platform. */
export const PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "threads",
  "youtube",
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Allowed aspect ratio as a `[width, height]` pair (e.g. `[9, 16]`). */
export type AspectRatio = readonly [number, number];

/** Media rules for one media kind (image or video) on a platform. */
export type MediaKindSpec = {
  /** Accepted MIME types (the hard, server-enforced gate — D-C4-3). */
  mimeTypes: readonly string[];
  /** Max file size in bytes (hard, server-enforced via a post-upload HEAD). */
  maxBytes: number;
  /**
   * Accepted aspect ratios. Empty = any ratio accepted. Advisory in the
   * composer (client-probed dims); the hard gate is publish time (F-epic).
   */
  aspectRatios: readonly AspectRatio[];
  /** Video only: max clip duration in seconds. Advisory (client-probed). */
  maxDurationSeconds?: number;
};

/**
 * Per-platform media specs (PRD §6, C4). Seeded from PRD §6 + common platform
 * limits — re-verify against the live Zernio/platform docs at each phase gate
 * (same discipline as `charLimit`). `null` = the platform doesn't accept that
 * media kind (e.g. TikTok/YouTube Shorts are video-only).
 */
export type MediaSpec = {
  image: MediaKindSpec | null;
  video: MediaKindSpec | null;
  /** Max attachments per platform variant (carousel/gallery ceiling). */
  maxAttachments: number;
};

export type PlatformConfig = {
  /** Our canonical id — matches the `social_accounts.platform` CHECK vocabulary. */
  id: Platform;
  /** Human label for UI (connect buttons, account cards). */
  label: string;
  /**
   * The slug Zernio's connect path expects: `GET /v1/connect/{zernioSlug}`.
   * Kept as an explicit mapping (not assumed identical to `id`) so a future
   * divergence between our vocabulary and Zernio's is a one-line change here.
   */
  zernioSlug: string;
  /**
   * Brand accent color (hex) for UI dots, badges, and preview accents (A7 design
   * system / postory-design mockups). Single source of truth — UI reads it here
   * rather than re-hardcoding platform colors.
   */
  color: string;
  /**
   * Maximum caption length (characters) the composer counter warns/blocks on
   * and `postContentSchema` validates against (C1, PRD §6). These are the
   * platform caption ceilings, not media specs — re-verify against the current
   * Zernio/platform docs at each phase gate (PRD §7.2 note).
   */
  charLimit: number;
  /** Per-platform media rules (C4, PRD §6). */
  media: MediaSpec;
};

// Shared MIME allowlists (single source — composed into the specs below).
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;

const MB = 1024 * 1024;

// Common aspect ratios (PRD §6).
const SQUARE: AspectRatio = [1, 1];
const PORTRAIT_4_5: AspectRatio = [4, 5];
const VERTICAL_9_16: AspectRatio = [9, 16];
const LANDSCAPE_16_9: AspectRatio = [16, 9];

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    zernioSlug: "instagram",
    color: "#d6336c",
    charLimit: 2200,
    // Feed image/carousel (1:1, 4:5) + Reels (9:16 video). PRD §6.
    media: {
      image: {
        mimeTypes: IMAGE_MIMES,
        maxBytes: 30 * MB,
        aspectRatios: [SQUARE, PORTRAIT_4_5],
      },
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 300 * MB,
        aspectRatios: [VERTICAL_9_16],
        maxDurationSeconds: 90,
      },
      maxAttachments: 10,
    },
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    zernioSlug: "facebook",
    color: "#1877f2",
    charLimit: 63206,
    // Page image/video posts — permissive on ratio. PRD §6.
    media: {
      image: {
        mimeTypes: IMAGE_MIMES,
        maxBytes: 30 * MB,
        aspectRatios: [SQUARE, PORTRAIT_4_5, LANDSCAPE_16_9, VERTICAL_9_16],
      },
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 500 * MB,
        aspectRatios: [],
        maxDurationSeconds: 240,
      },
      maxAttachments: 10,
    },
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    zernioSlug: "tiktok",
    color: "#16181c",
    charLimit: 2200,
    // Video-only at launch (9:16). PRD §6 / D3.
    media: {
      image: null,
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 500 * MB,
        aspectRatios: [VERTICAL_9_16],
        maxDurationSeconds: 600,
      },
      maxAttachments: 1,
    },
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    zernioSlug: "linkedin",
    color: "#0a66c2",
    charLimit: 3000,
    // Image/video/text on company + personal pages. PRD §6.
    media: {
      image: {
        mimeTypes: IMAGE_MIMES,
        maxBytes: 30 * MB,
        aspectRatios: [SQUARE, PORTRAIT_4_5, LANDSCAPE_16_9],
      },
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 500 * MB,
        aspectRatios: [],
        maxDurationSeconds: 600,
      },
      maxAttachments: 9,
    },
  },
  threads: {
    id: "threads",
    label: "Threads",
    zernioSlug: "threads",
    color: "#000000",
    // PRD §6: Threads 500-char limit (the mockup's config omits Threads).
    charLimit: 500,
    // Text/image (+ short video); light validation per PRD §6.
    media: {
      image: {
        mimeTypes: IMAGE_MIMES,
        maxBytes: 30 * MB,
        aspectRatios: [],
      },
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 300 * MB,
        aspectRatios: [],
        maxDurationSeconds: 300,
      },
      maxAttachments: 10,
    },
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    zernioSlug: "youtube",
    color: "#e02f2f",
    charLimit: 5000,
    // Shorts only: 9:16, ≤ 60s. PRD §6 (title required is a caption concern).
    media: {
      image: null,
      video: {
        mimeTypes: VIDEO_MIMES,
        maxBytes: 500 * MB,
        aspectRatios: [VERTICAL_9_16],
        maxDurationSeconds: 60,
      },
      maxAttachments: 1,
    },
  },
};

/** Ordered list for rendering (connect menu, matrices). */
export const PLATFORM_LIST: readonly PlatformConfig[] = PLATFORMS.map(
  (id) => PLATFORM_CONFIG[id],
);

/**
 * The image aspect presets offered by AI image generation (D1, PRD §D1:
 * 1:1, 4:5, 9:16, 16:9). Ordered for the composer's preset picker. The `id` is
 * also exactly the `${w}:${h}` string the OpenRouter Image API / AI SDK
 * `generateImage` `aspectRatio` param expects, so it doubles as the wire value.
 * Reuses the shared ratio constants above (single source — §4).
 */
export const IMAGE_ASPECT_PRESETS = [
  { id: "1:1", label: "Square", ratio: SQUARE },
  { id: "4:5", label: "Portrait", ratio: PORTRAIT_4_5 },
  { id: "9:16", label: "Vertical", ratio: VERTICAL_9_16 },
  { id: "16:9", label: "Landscape", ratio: LANDSCAPE_16_9 },
] as const;

/** A supported image aspect preset id (also the wire `aspectRatio` value). */
export type ImageAspectPreset = (typeof IMAGE_ASPECT_PRESETS)[number]["id"];

/** All preset ids, for the validation enum + UI iteration. */
export const IMAGE_ASPECT_PRESET_IDS = IMAGE_ASPECT_PRESETS.map(
  (p) => p.id,
) as [ImageAspectPreset, ...ImageAspectPreset[]];

/**
 * Which image aspect presets a platform prefers (D1 preset picker). Empty
 * `aspectRatios` = any ratio, so all presets apply; a platform with no image
 * spec (TikTok/YouTube = video-only) returns none. Advisory only — it seeds the
 * recommended presets in the UI, the same way `assetFitsPlatform` is advisory.
 */
export function imagePresetsForPlatform(
  platform: Platform,
): readonly ImageAspectPreset[] {
  const spec = PLATFORM_CONFIG[platform].media.image;
  if (!spec) return [];
  if (spec.aspectRatios.length === 0)
    return IMAGE_ASPECT_PRESETS.map((p) => p.id);
  return IMAGE_ASPECT_PRESETS.filter((preset) =>
    spec.aspectRatios.some(
      ([w, h]) => w === preset.ratio[0] && h === preset.ratio[1],
    ),
  ).map((p) => p.id);
}

/** Type guard: is an arbitrary string one of our launch platforms? */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Config for a platform, or undefined if it isn't a launch platform. */
export function getPlatformConfig(value: string): PlatformConfig | undefined {
  return isPlatform(value) ? PLATFORM_CONFIG[value] : undefined;
}

/** Caption character ceiling for a platform (C1 composer counter/validation). */
export function getCharLimit(platform: Platform): number {
  return PLATFORM_CONFIG[platform].charLimit;
}

/** Media specs for a platform (C4 composer validation + preview cards). */
export function getMediaSpec(platform: Platform): MediaSpec {
  return PLATFORM_CONFIG[platform].media;
}

/**
 * Accepted MIME types for a media kind, across ALL platforms (the union) — the
 * upload-level allowlist (an asset is a reusable brand asset, not tied to one
 * platform at upload time; per-platform fit is `assetFitsPlatform`, advisory at
 * attach). Single source for the media validation schema.
 */
export function acceptedMimesForKind(
  kind: "image" | "video",
): readonly string[] {
  // Derive the union from every platform's spec (not a shared constant) so a
  // per-platform MIME narrowing/addition is reflected here automatically.
  const mimes = new Set<string>();
  for (const p of PLATFORM_LIST) {
    const kindSpec = kind === "image" ? p.media.image : p.media.video;
    for (const mime of kindSpec?.mimeTypes ?? []) mimes.add(mime);
  }
  return [...mimes];
}

/** Upload-level max size (bytes) for a kind = the largest any platform allows. */
export function maxUploadBytesForKind(kind: "image" | "video"): number {
  return Math.max(
    ...PLATFORM_LIST.map((p) => {
      const kindSpec = kind === "image" ? p.media.image : p.media.video;
      return kindSpec?.maxBytes ?? 0;
    }),
  );
}

/** Classify a MIME type into our media kind, or null if it's neither. */
export function mediaKindForMime(mime: string): "image" | "video" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/** The subset of an asset used for spec checks (a subset of `media_assets`). */
export type MediaAssetSpecInput = {
  kind: "image" | "video";
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

/** Relative tolerance when matching a probed aspect ratio to an allowed one. */
const ASPECT_TOLERANCE = 0.03;

function matchesAnyRatio(
  width: number,
  height: number,
  ratios: readonly AspectRatio[],
): boolean {
  if (ratios.length === 0) return true; // any ratio accepted
  if (height <= 0) return false;
  const actual = width / height;
  return ratios.some(([w, h]) => {
    const target = w / h;
    return Math.abs(actual - target) / target <= ASPECT_TOLERANCE;
  });
}

/**
 * Does an asset fit a platform's media spec? Pure — shared by the composer
 * (advisory warnings) and preview cards (C5). MIME + size are the hard,
 * server-enforced gates (D-C4-3); aspect ratio + duration are advisory here
 * (dims come from a client probe) and hard-gated at publish (F-epic). Missing
 * dims/duration are not flagged (probe may be unavailable), only violated ones.
 */
export function assetFitsPlatform(
  platform: Platform,
  asset: MediaAssetSpecInput,
): { ok: boolean; warnings: string[] } {
  const spec = PLATFORM_CONFIG[platform].media;
  const label = PLATFORM_CONFIG[platform].label;
  const kindSpec = asset.kind === "image" ? spec.image : spec.video;
  const warnings: string[] = [];

  if (!kindSpec) {
    warnings.push(`${label} doesn't accept ${asset.kind} media.`);
    return { ok: false, warnings };
  }

  if (asset.mimeType && !kindSpec.mimeTypes.includes(asset.mimeType)) {
    warnings.push(`${label} doesn't support ${asset.mimeType} files.`);
  }
  if (
    typeof asset.sizeBytes === "number" &&
    asset.sizeBytes > kindSpec.maxBytes
  ) {
    const maxMb = Math.round(kindSpec.maxBytes / MB);
    warnings.push(`${label} files must be ${maxMb} MB or smaller.`);
  }
  if (
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    !matchesAnyRatio(asset.width, asset.height, kindSpec.aspectRatios)
  ) {
    const ratios = kindSpec.aspectRatios
      .map(([w, h]) => `${w}:${h}`)
      .join(", ");
    warnings.push(`${label} prefers ${ratios} for ${asset.kind}.`);
  }
  if (
    asset.kind === "video" &&
    typeof kindSpec.maxDurationSeconds === "number" &&
    typeof asset.durationSeconds === "number" &&
    asset.durationSeconds > kindSpec.maxDurationSeconds
  ) {
    warnings.push(
      `${label} videos must be ${kindSpec.maxDurationSeconds}s or shorter.`,
    );
  }

  return { ok: warnings.length === 0, warnings };
}
