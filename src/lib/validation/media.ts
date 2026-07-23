import * as z from "zod";
import {
  acceptedMimesForKind,
  maxUploadBytesForKind,
} from "@/lib/platforms/config";

/**
 * Media upload input schemas (C4). Canonical zod home per AGENTS.md §4 —
 * validated at the server-action boundary (§7/§9) and reused by the composer.
 * Per-platform media *specs* live in `platforms/config.ts` (single source);
 * this reads the upload-level allowlist from there, never hardcoding it.
 *
 * Uploads flow presigned direct-to-store PUT: `createUploadSchema` validates
 * the request to mint a presigned URL (declared mime + size), then the client
 * PUTs the bytes to R2/MinIO, then `recordUploadSchema` records the row — the
 * server re-reads the ACTUAL mime + size via a HEAD (authoritative gate),
 * storing the client-probed dims/duration as reported (server-side dimension
 * probing is a deferred D5 hardening — D-C4-3).
 */

/** Media kind — mirrors the `media_assets.kind` CHECK vocabulary. */
export const mediaKindSchema = z.enum(["image", "video"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Request a presigned upload URL. `brandId` is re-checked server-side. */
export const createUploadSchema = z
  .object({
    brandId: z.uuid("Brand id is required."),
    kind: mediaKindSchema,
    mimeType: z.string().min(1),
    // Declared size — re-verified authoritatively via HEAD after upload.
    sizeBytes: z.number().int().positive(),
    // Client-probed dimensions/duration (advisory; may be absent).
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationSeconds: z.number().positive().optional(),
  })
  .superRefine((input, ctx) => {
    if (!acceptedMimesForKind(input.kind).includes(input.mimeType)) {
      ctx.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: `Unsupported ${input.kind} type: ${input.mimeType}.`,
      });
    }
    const max = maxUploadBytesForKind(input.kind);
    if (input.sizeBytes > max) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeBytes"],
        message: `File is too large (max ${Math.round(max / (1024 * 1024))} MB).`,
      });
    }
  });
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

/**
 * Record an asset after the client PUT succeeded. `r2Key` is the key the
 * matching `createUploadUrl` minted — re-validated server-side to belong to the
 * caller's org + brand (never a client-chosen path). Mime + size come from the
 * server's HEAD, not this input; dims/duration are the client probe.
 */
export const recordUploadSchema = z.object({
  brandId: z.uuid("Brand id is required."),
  r2Key: z.string().min(1),
  kind: mediaKindSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
});
export type RecordUploadInput = z.infer<typeof recordUploadSchema>;

/**
 * Asset-library facet filters (D4) live in the URL and are owned by **nuqs** —
 * the parser map + server loader are in
 * `components/features/media/search-params.ts` (shared by the page and the
 * client filter row), so there is no zod schema for them here. No free-text
 * search — media_assets has no textual field to match on.
 */

/** Delete one asset (D4). brandId scopes revalidation; the DAL re-checks it. */
export const deleteMediaSchema = z.object({
  brandId: z.uuid("Brand id is required."),
  mediaId: z.uuid("Media id is required."),
});
export type DeleteMediaInput = z.infer<typeof deleteMediaSchema>;
