import "server-only";
import { publicUrl } from "@/server/services/storage";

/**
 * Map a persisted media row to the serving-ready view the UI consumes
 * (MediaAssetView in components/composer/media-types) — attaching the public
 * `url` (publicUrl is server-only) and narrowing `kind`. The single mapper for
 * this shape (§4). Return type is inferred so this server module needn't import
 * the client-side view type.
 *
 * NOTE (§12 follow-up, not a drive-by refactor here): the composer page, the
 * /media page, and the recordUpload action each still build this shape inline
 * (pre-dating this helper) — migrate them to `toMediaAssetView` in their own PR.
 */
export function toMediaAssetView(asset: {
  id: string;
  kind: string;
  r2Key: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  moderationStatus: string;
}) {
  return {
    id: asset.id,
    // The media_assets kind column is constrained to image|video.
    kind: asset.kind as "image" | "video",
    url: publicUrl(asset.r2Key),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    moderationStatus: asset.moderationStatus,
  };
}
