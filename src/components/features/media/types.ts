import type { MediaAssetView } from "@/components/features/composer/media-types";

/**
 * A media asset as the D4 library page consumes it — the composer's
 * `MediaAssetView` (serving `url`, never the raw r2Key) enriched with the
 * library-only facets: where it came from, when it was created (ISO string so it
 * serializes cleanly across the RSC boundary), and how many posts use it.
 */
export type MediaLibraryItem = MediaAssetView & {
  source: "upload" | "generated";
  createdAt: string;
  usageCount: number;
};
