import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/db";
import { mediaAssets } from "@/db/schemas/media";
import { NotFoundError } from "@/server/domain/errors";
import { recordAuditEvent } from "./audit";
import { getById as getGenerationJobById } from "./generation-jobs";
import { assertBrandAccess, brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Media DAL (C4 — uploads to the R2/MinIO-backed asset library). Org-scoped
 * like every module (AGENTS.md §6): ctx first, orgScope in every where-clause,
 * brand access asserted for creators, cross-org reads indistinguishable from
 * not-found.
 *
 * C4 owns user uploads (source='upload'); Epic D adds AI-generated assets
 * (source='generated', with a source model + generation_job_id) via
 * `recordGeneratedAsset`. The standalone asset-library page + delete + orphan
 * cleanup are D4. Both sources start moderationStatus='pending' (D5 moderation
 * gates them before publish, F-epic).
 */

export type MediaAsset = {
  id: string;
  brandId: string;
  kind: string;
  source: string;
  r2Key: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  moderationStatus: string;
};

const MEDIA_COLUMNS = {
  id: mediaAssets.id,
  brandId: mediaAssets.brandId,
  kind: mediaAssets.kind,
  source: mediaAssets.source,
  r2Key: mediaAssets.r2Key,
  mimeType: mediaAssets.mimeType,
  sizeBytes: mediaAssets.sizeBytes,
  width: mediaAssets.width,
  height: mediaAssets.height,
  durationSeconds: mediaAssets.durationSeconds,
  moderationStatus: mediaAssets.moderationStatus,
} as const;

/**
 * Insert a media_asset row + its `media.create` audit (Case B, dal/audit.ts:
 * DB-generated uuidv7, so insert then audit). Shared by `recordUpload` (C4) and
 * `recordGeneratedAsset` (D2) — the only difference is `source` and the
 * generation provenance columns (rule-of-two, §4). Tenancy is the caller's job
 * (org_id from ctx, brand access asserted); role is gated upstream.
 */
async function insertMediaAsset(
  ctx: AuthCtx,
  values: {
    brandId: string;
    kind: "image" | "video";
    source: "upload" | "generated";
    r2Key: string;
    mimeType: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    sourceModel?: string | null;
    generationJobId?: string | null;
  },
): Promise<MediaAsset> {
  const [row] = await db
    .insert(mediaAssets)
    .values({
      orgId: ctx.orgId,
      brandId: values.brandId,
      kind: values.kind,
      source: values.source,
      r2Key: values.r2Key,
      mimeType: values.mimeType,
      sizeBytes: values.sizeBytes,
      width: values.width,
      height: values.height,
      durationSeconds: values.durationSeconds,
      sourceModel: values.sourceModel ?? null,
      generationJobId: values.generationJobId ?? null,
      // moderationStatus defaults 'pending' (D5).
    })
    .returning(MEDIA_COLUMNS);
  if (!row) throw new Error("media_asset insert returned no row");
  await recordAuditEvent(ctx, {
    action: "media.create",
    entityType: "media_asset",
    entityId: row.id,
    metadata: {
      brandId: values.brandId,
      kind: values.kind,
      source: values.source,
    },
  });
  return row;
}

/**
 * Record an uploaded asset. Role is gated upstream (authorize "post:create");
 * this owns tenancy + the audit pairing. org_id comes from ctx, never input;
 * the r2Key was minted server-side (org/brand-prefixed) and the mime/size come
 * from the action's authoritative HEAD, not client claims.
 */
export async function recordUpload(
  ctx: AuthCtx,
  input: {
    brandId: string;
    kind: "image" | "video";
    r2Key: string;
    mimeType: string | null;
    sizeBytes: number | null;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
  },
): Promise<MediaAsset> {
  assertBrandAccess(ctx, input.brandId);
  return insertMediaAsset(ctx, {
    brandId: input.brandId,
    kind: input.kind,
    source: "upload",
    r2Key: input.r2Key,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSeconds: input.durationSeconds ?? null,
  });
}

/**
 * Record an AI-generated image asset (D2). Called from the generation Inngest
 * job (system ctx) after the image is stored in R2: `source='generated'`, with
 * the OpenRouter model id (`sourceModel`) and the `generationJobId` linking back
 * to the job (schema FK, ON DELETE SET NULL). Generated images are always
 * images at launch (video is D7). Tenancy is enforced here (brand access +
 * org_id from ctx); moderation stays 'pending' until D5.
 */
export async function recordGeneratedAsset(
  ctx: AuthCtx,
  input: {
    brandId: string;
    r2Key: string;
    mimeType: string;
    sizeBytes: number;
    width?: number | null;
    height?: number | null;
    sourceModel: string;
    generationJobId: string;
  },
): Promise<MediaAsset> {
  assertBrandAccess(ctx, input.brandId);
  // Validate the generation job is org-scoped + brand-accessible before linking
  // it (the FK is single-column, so it wouldn't catch a cross-org job id). This
  // 404s a missing/cross-org/unassigned job and rejects a job/brand mismatch, so
  // a bad link can never be written — the DAL owns its own scoping (§6).
  const job = await getGenerationJobById(ctx, input.generationJobId);
  if (job.brandId !== input.brandId) {
    throw new NotFoundError("generation_job", input.generationJobId);
  }
  return insertMediaAsset(ctx, {
    brandId: input.brandId,
    kind: "image",
    source: "generated",
    r2Key: input.r2Key,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSeconds: null,
    sourceModel: input.sourceModel,
    generationJobId: input.generationJobId,
  });
}

/**
 * A brand's media assets, newest first — the composer library picker (C4).
 * Org-scoped + brand access asserted (creators 404 on unassigned brands). The
 * optional `limit` bounds the initial RSC payload; full search/pagination is D4.
 */
export async function listMediaForBrand(
  ctx: AuthCtx,
  brandId: string,
  limit?: number,
): Promise<MediaAsset[]> {
  assertBrandAccess(ctx, brandId);
  const query = db
    .select(MEDIA_COLUMNS)
    .from(mediaAssets)
    .where(and(orgScope(ctx, mediaAssets), eq(mediaAssets.brandId, brandId)))
    .orderBy(desc(mediaAssets.createdAt));
  return limit === undefined ? query : query.limit(limit);
}

/**
 * Assets by id, org + brand-access scoped (C4 — hydrate attached media in the
 * composer's edit mode + validate an attach request). Returns only the ids the
 * caller can see; a missing id is silently dropped (404-shape by omission).
 */
export async function getMediaByIds(
  ctx: AuthCtx,
  ids: string[],
): Promise<MediaAsset[]> {
  if (ids.length === 0) return [];
  return db
    .select(MEDIA_COLUMNS)
    .from(mediaAssets)
    .where(
      and(
        orgScope(ctx, mediaAssets),
        inArray(mediaAssets.id, ids),
        // Creators are additionally scoped to assigned brands (empty → false).
        brandScope(ctx, mediaAssets.brandId),
      ),
    );
}

/** A NotFoundError-throwing single-asset read (§7 scoped fetch shape). */
export async function getMediaById(
  ctx: AuthCtx,
  id: string,
): Promise<MediaAsset> {
  const [row] = await db
    .select(MEDIA_COLUMNS)
    .from(mediaAssets)
    .where(and(orgScope(ctx, mediaAssets), eq(mediaAssets.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("media_asset", id);
  assertBrandAccess(ctx, row.brandId);
  return row;
}
