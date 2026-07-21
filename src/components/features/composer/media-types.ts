/**
 * A serving-ready media asset as the composer UI consumes it (C4). Built by the
 * `recordUpload` action (on upload) and by the composer page from
 * `dal.media.listMediaForBrand` (the library picker) — both add the public
 * `url` (never the raw r2Key). Isomorphic: a type only, safe on the client.
 */
export type MediaAssetView = {
  id: string;
  kind: "image" | "video";
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  moderationStatus: string;
};
