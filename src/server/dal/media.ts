import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/db";
import { mediaAssets } from "@/db/schemas/media";
import { NotFoundError } from "@/server/domain/errors";
import { recordAuditEvent } from "./audit";
import { assertBrandAccess, brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Media DAL (C4 — uploads to the R2/MinIO-backed asset library). Org-scoped
 * like every module (AGENTS.md §6): ctx first, orgScope in every where-clause,
 * brand access asserted for creators, cross-org reads indistinguishable from
 * not-found.
 *
 * C4 owns only user uploads (source='upload'). AI-generated assets
 * (source='generated', with a generation_job_id) land with Epic D; the standalone
 * asset-library page + delete + orphan cleanup are D4. New uploads start
 * moderationStatus='pending' (D5 moderation gates them before publish, F-epic).
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
 * Record an uploaded asset. Role is gated upstream (authorize "post:create");
 * this owns tenancy + the audit pairing. org_id comes from ctx, never input;
 * the r2Key was minted server-side (org/brand-prefixed) and the mime/size come
 * from the action's authoritative HEAD, not client claims. Case B
 * (dal/audit.ts): DB-generated uuidv7, so insert then audit.
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
  const [row] = await db
    .insert(mediaAssets)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId,
      kind: input.kind,
      source: "upload",
      r2Key: input.r2Key,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      // moderationStatus defaults 'pending' (D5).
    })
    .returning(MEDIA_COLUMNS);
  if (!row) throw new Error("media_asset insert returned no row");
  await recordAuditEvent(ctx, {
    action: "media.create",
    entityType: "media_asset",
    entityId: row.id,
    metadata: { brandId: input.brandId, kind: input.kind, source: "upload" },
  });
  return row;
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
