"use server";

import { revalidatePath } from "next/cache";
import {
  acceptedMimesForKind,
  maxUploadBytesForKind,
  mediaKindForMime,
} from "@/lib/platforms/config";
import {
  createUploadSchema,
  deleteMediaSchema,
  recordUploadSchema,
} from "@/lib/validation/media";
import { getBrandById } from "@/server/dal/brands";
import {
  deleteMediaAsset,
  recordUpload as recordUploadRow,
} from "@/server/dal/media";
import { MediaRejectedError, NotFoundError } from "@/server/domain/errors";
import { captureError, log } from "@/server/services/observability";
import {
  buildMediaKey,
  deleteObject,
  headObject,
  presignPut,
  publicUrl,
} from "@/server/services/storage";
import { withAction } from "./with-action";

/**
 * Media upload actions (C4). Uploads flow presigned direct-to-store PUT (never
 * `File` bytes through the action — §RPC / video is P0-large): `createUploadUrl`
 * mints a server-generated key + presigned URL, the client PUTs to R2/MinIO,
 * then `recordUpload` confirms via a server→store HEAD (the authoritative
 * mime/size gate, D-C4-3) and records the row.
 *
 * Both reuse `post:create` (the composer is the creator's surface; §7 matrix
 * already covers it — no permissions.ts change). ADR-003 doesn't apply: an
 * upload is an ordinary synchronous mutation, not the generation/publishing
 * workload (moderation + transcoding jobs are D5/later).
 */

/** File extension for the R2 key, by accepted MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/**
 * Mint a presigned PUT URL for a new upload. Validates the declared mime/size
 * (the hard re-check is `recordUpload`'s HEAD), scopes the brand (§7), and
 * builds the key server-side (org/brand-prefixed — never client-supplied).
 */
export const createUploadUrl = withAction(
  createUploadSchema,
  "post:create",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch (cross-org / unassigned brand 404s here).
    await getBrandById(ctx, data.brandId);

    const ext = EXT_BY_MIME[data.mimeType] ?? "bin";
    const r2Key = buildMediaKey(ctx.orgId, data.brandId, ext);
    const url = await presignPut({
      key: r2Key,
      kind: data.kind,
      contentType: data.mimeType,
      sizeBytes: data.sizeBytes,
    });
    // r2Key echoes back to the client, which returns it to `recordUpload`; it's
    // org/brand-prefixed and re-validated there, so it's safe to hand out.
    return { r2Key, url };
  },
);

/**
 * Record an uploaded asset after the client PUT. Re-validates that the key is
 * under the caller's org+brand prefix (tenancy), HEADs the object to read its
 * ACTUAL mime/size (the authoritative gate — client claims are never trusted),
 * then persists the `media_assets` row (source='upload', moderation 'pending').
 */
export const recordUpload = withAction(
  recordUploadSchema,
  "post:create",
  async (data, ctx) => {
    await getBrandById(ctx, data.brandId);

    // Tenancy: the key must be one we would have minted for this org+brand.
    // 404-shape (never reveal another tenant's key space).
    const prefix = `org/${ctx.orgId}/brand/${data.brandId}/`;
    if (!data.r2Key.startsWith(prefix)) {
      throw new NotFoundError("media_asset", data.r2Key);
    }

    const head = await headObject(data.r2Key);
    if (!head) {
      throw new MediaRejectedError("Upload not found — please try again.");
    }

    // Server-authoritative mime gate: the STORED content-type must be an
    // accepted type for the declared kind (D-C4-3).
    const mimeType = head.contentType;
    if (
      !mimeType ||
      mediaKindForMime(mimeType) !== data.kind ||
      !acceptedMimesForKind(data.kind).includes(mimeType)
    ) {
      throw new MediaRejectedError(
        `Unsupported ${data.kind} type${mimeType ? `: ${mimeType}` : ""}.`,
      );
    }

    // Server-authoritative size gate: the STORED size, not the declared one.
    const sizeBytes = head.sizeBytes;
    const maxBytes = maxUploadBytesForKind(data.kind);
    if (typeof sizeBytes === "number" && sizeBytes > maxBytes) {
      throw new MediaRejectedError(
        `File is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).`,
      );
    }

    const asset = await recordUploadRow(ctx, {
      brandId: data.brandId,
      kind: data.kind,
      r2Key: data.r2Key,
      mimeType,
      sizeBytes,
      width: data.width ?? null,
      height: data.height ?? null,
      durationSeconds: data.durationSeconds ?? null,
    });

    revalidatePath(`/brands/${data.brandId}/composer`);

    // Minimal, serving-ready view (§7 — never expose the raw r2Key).
    return {
      id: asset.id,
      kind: asset.kind,
      url: publicUrl(asset.r2Key),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      moderationStatus: asset.moderationStatus,
    };
  },
);

/**
 * Delete a media asset from the library (D4). Reuses `post:create` like the
 * upload actions (the library is the creator's surface; §7 matrix already
 * covers it — no permissions.ts change). The DAL does the §7 scoped fetch
 * (404s cross-org/unassigned), deletes the row + audits atomically, and returns
 * the r2Key; we then delete the object. In-use deletes are allowed (the UI
 * warns) — dangling `media_ids` in immutable post_versions degrade gracefully
 * (getMediaByIds/resolveMediaAssets drop missing ids).
 */
export const deleteMedia = withAction(
  deleteMediaSchema,
  "post:create",
  async (data, ctx) => {
    const r2Key = await deleteMediaAsset(ctx, data.mediaId);

    // Best-effort object delete AFTER the row is gone (DB-first): a stray object
    // is harmless (the orphan sweep / storage lifecycle tolerates it), so a
    // storage miss must never fail the action — the asset is already unlinked.
    try {
      await deleteObject(r2Key);
    } catch (error) {
      captureError(error, { ctx });
      log.warn("media row deleted but its storage object was not removed", {
        event: "media.delete.object_orphaned",
        mediaId: data.mediaId,
      });
    }

    revalidatePath(`/brands/${data.brandId}/media`);
    return { id: data.mediaId };
  },
);
