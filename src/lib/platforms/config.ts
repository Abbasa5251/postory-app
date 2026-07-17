/**
 * Platform configuration — the single source of truth for the launch social
 * networks (AGENTS.md §4). Composer validation, preview cards, pre-publish
 * checks, and the B3 connect flow all read from here; adding a platform
 * post-launch is a config edit, not an architecture change (PRD §6).
 *
 * Isomorphic-safe (lib/): no server imports, no secrets. The per-platform
 * media/character rules (PRD §6) attach to these entries as later epics need
 * them — B3 only needs the identity + Zernio connect slug + display label.
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
};

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  instagram: { id: "instagram", label: "Instagram", zernioSlug: "instagram" },
  facebook: { id: "facebook", label: "Facebook", zernioSlug: "facebook" },
  tiktok: { id: "tiktok", label: "TikTok", zernioSlug: "tiktok" },
  linkedin: { id: "linkedin", label: "LinkedIn", zernioSlug: "linkedin" },
  threads: { id: "threads", label: "Threads", zernioSlug: "threads" },
  youtube: { id: "youtube", label: "YouTube", zernioSlug: "youtube" },
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
