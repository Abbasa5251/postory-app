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
};

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    zernioSlug: "instagram",
    color: "#d6336c",
    charLimit: 2200,
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    zernioSlug: "facebook",
    color: "#1877f2",
    charLimit: 63206,
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    zernioSlug: "tiktok",
    color: "#16181c",
    charLimit: 2200,
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    zernioSlug: "linkedin",
    color: "#0a66c2",
    charLimit: 3000,
  },
  threads: {
    id: "threads",
    label: "Threads",
    zernioSlug: "threads",
    color: "#000000",
    // PRD §6: Threads 500-char limit (the mockup's config omits Threads).
    charLimit: 500,
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    zernioSlug: "youtube",
    color: "#e02f2f",
    charLimit: 5000,
  },
};

/** Ordered list for rendering (connect menu, matrices). */
export const PLATFORM_LIST: readonly PlatformConfig[] = PLATFORMS.map(
  (id) => PLATFORM_CONFIG[id],
);

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
