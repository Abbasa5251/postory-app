import { mediaKindForMime } from "@/lib/platforms/config";
import { createUploadUrl, recordUpload } from "@/server/actions/media";
import type { MediaAssetView } from "@/components/features/composer/media-types";

/**
 * Shared client-side upload primitives (C4 + D4). The presigned direct-to-store
 * flow — client-probe dims → mint a presigned URL → PUT the bytes → record the
 * row — used by both the composer's MediaCard (attach on upload) and the D4
 * library's Upload button (record only). Extracted here at the rule-of-two (§4);
 * server-side mime/size remain the authoritative gate in `recordUpload`.
 *
 * Browser-only (Image / XMLHttpRequest / document) — import from client
 * components only.
 */

/** How long a single PUT may stall before we give up (ms). Generous for large
 * video, but finite so a dead connection frees the upload slot. */
export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** A metadata probe must never hang the upload; give up after this (ms). */
const PROBE_TIMEOUT_MS = 5_000;

/** Client-probe an image/video for its natural dimensions (+ video duration). */
export async function probeDimensions(
  file: File,
  kind: "image" | "video",
): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const url = URL.createObjectURL(file);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Reject if metadata never arrives (corrupt file, an onload/onerror that
    // never fires) so the catch below returns empty dims and the upload
    // proceeds rather than hanging forever.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("probe timed out")),
        PROBE_TIMEOUT_MS,
      );
    });
    if (kind === "image") {
      const img = new Image();
      const load = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("probe failed"));
        img.src = url;
      });
      await Promise.race([load, timeout]);
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    const load = new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("probe failed"));
      video.src = url;
    });
    await Promise.race([load, timeout]);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Math.round(video.duration),
    };
  } catch {
    // Probe is advisory — a failure (or timeout) just means no dims (server
    // still gates mime/size; publish gates aspect/duration). Don't block the
    // upload.
    return {};
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}

/** PUT the file straight to R2/MinIO via the presigned URL, reporting progress. */
export function putToStore(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    // Finite timeout: without it a stalled PUT leaves the upload spinning
    // forever (the row is never recorded and the slot never frees).
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

/**
 * The full upload sequence for one file: validate kind → probe → presign →
 * PUT (with progress) → record. Returns the recorded, serving-ready asset.
 * Throws a user-safe Error on any step failure (the caller surfaces it).
 */
export async function uploadFile(
  brandId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<MediaAssetView> {
  const kind = mediaKindForMime(file.type);
  if (kind !== "image" && kind !== "video") {
    throw new Error("unsupported file type.");
  }
  const dims = await probeDimensions(file, kind);
  const created = await createUploadUrl({
    brandId,
    kind,
    mimeType: file.type,
    sizeBytes: file.size,
    ...dims,
  });
  if (!created.ok) {
    throw new Error(created.error.message || "Could not start upload.");
  }
  await putToStore(created.data.url, file, onProgress);
  const recorded = await recordUpload({
    brandId,
    r2Key: created.data.r2Key,
    kind,
    width: dims.width,
    height: dims.height,
    durationSeconds: dims.durationSeconds,
  });
  if (!recorded.ok) {
    throw new Error(recorded.error.message || "Could not save upload.");
  }
  // The action returns `kind` as a string column; narrow to the view's union
  // (it can only ever be the kind we uploaded).
  return recorded.data as MediaAssetView;
}
