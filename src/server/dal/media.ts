import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/db";
import { mediaAssets } from "@/db/schemas/media";
import { postVersions } from "@/db/schemas/posts";
import type { ModerationStatus } from "@/lib/validation/media";
import { NotFoundError } from "@/server/domain/errors";
import { buildAuditInsert, recordAuditEvent } from "./audit";
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
  createdAt: Date;
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
  createdAt: mediaAssets.createdAt,
} as const;

/** Facet filters for the D4 asset-library listing (all optional, backed by
 * real columns — the media_assets kind/source/moderation vocabularies). */
export type MediaFilter = {
  kind?: "image" | "video";
  source?: "upload" | "generated";
  moderationStatus?: "pending" | "passed" | "blocked";
  limit?: number;
};

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
 * A brand's media assets, newest first — the composer library picker (C4) and
 * the D4 asset-library page. Org-scoped + brand access asserted (creators 404 on
 * unassigned brands). Optional facet filters (kind/source/moderation) narrow the
 * list against real columns; `limit` bounds the payload. Keyset pagination is a
 * deferred follow-up (a generous limit suffices at launch scale).
 */
export async function listMediaForBrand(
  ctx: AuthCtx,
  brandId: string,
  filter: MediaFilter = {},
): Promise<MediaAsset[]> {
  assertBrandAccess(ctx, brandId);
  const conditions = [
    orgScope(ctx, mediaAssets),
    eq(mediaAssets.brandId, brandId),
  ];
  if (filter.kind) conditions.push(eq(mediaAssets.kind, filter.kind));
  if (filter.source) conditions.push(eq(mediaAssets.source, filter.source));
  if (filter.moderationStatus)
    conditions.push(eq(mediaAssets.moderationStatus, filter.moderationStatus));
  const query = db
    .select(MEDIA_COLUMNS)
    .from(mediaAssets)
    .where(and(...conditions))
    .orderBy(desc(mediaAssets.createdAt));
  return filter.limit === undefined ? query : query.limit(filter.limit);
}

/**
 * How many distinct posts reference each of `ids` (D4 usage count). Media is
 * linked only via the `post_versions.media_ids` uuid[] roll-up (no FK — schema
 * comment), so this LEFT JOINs versions whose array contains the asset id and
 * counts distinct posts. One org-scoped query for a whole page; assets with no
 * usage still appear (LEFT JOIN → count 0). Returns a Map keyed by asset id.
 */
export async function countMediaUsage(
  ctx: AuthCtx,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: mediaAssets.id,
      uses: sql<number>`count(distinct ${postVersions.postId})`,
    })
    .from(mediaAssets)
    .leftJoin(
      postVersions,
      and(
        eq(postVersions.orgId, mediaAssets.orgId),
        sql`${mediaAssets.id} = any(${postVersions.mediaIds})`,
      ),
    )
    .where(
      and(
        orgScope(ctx, mediaAssets),
        inArray(mediaAssets.id, ids),
        // Same brand narrowing as getMediaByIds (creators → assigned brands
        // only), so counts can't be computed for ids outside the caller's
        // reach even if a caller forgets to pre-filter (§6.4 belt-and-suspenders).
        brandScope(ctx, mediaAssets.brandId),
      ),
    )
    .groupBy(mediaAssets.id);
  // count() comes back as a bigint string on the wire — coerce to number.
  return new Map(rows.map((r) => [r.id, Number(r.uses)]));
}

/**
 * Delete a media asset (D4). §7 scoped fetch first (getMediaById 404s
 * cross-org/unassigned and yields the r2Key the caller must remove from
 * storage), then an atomic Case-A `db.batch` delete + `media.delete` audit
 * (dal/audit.ts). Returns the asset's VERIFIED `brandId` (from the scoped fetch,
 * not caller input — the caller revalidates that brand's page) and `r2Key` so
 * the caller (action or sweep) can delete the object AFTER the row is gone —
 * DB-first, because a stray object is harmless but a dangling row is not. Shared
 * by the delete action and the orphan-cleanup sweep.
 */
export async function deleteMediaAsset(
  ctx: AuthCtx,
  id: string,
): Promise<{ r2Key: string; brandId: string }> {
  const asset = await getMediaById(ctx, id);
  const [deleted] = await db.batch([
    db
      .delete(mediaAssets)
      .where(and(orgScope(ctx, mediaAssets), eq(mediaAssets.id, id)))
      .returning({ id: mediaAssets.id }),
    buildAuditInsert(ctx, {
      action: "media.delete",
      entityType: "media_asset",
      entityId: id,
      metadata: { brandId: asset.brandId, source: asset.source },
    }),
  ]);
  if (deleted.length === 0) throw new NotFoundError("media_asset", id);
  return { r2Key: asset.r2Key, brandId: asset.brandId };
}

/**
 * Transition an asset's moderation status (D5 — "block + log"). §7 scoped fetch
 * first (getMediaById 404s cross-org/unassigned), then an atomic Case-A
 * `db.batch` UPDATE + audit (`media.moderation_blocked` | `media.moderation_passed`)
 * so a status flip can never land without a matching audit row (§6.6). Called
 * from the generation job's SystemCtx after the output judge runs; the reason /
 * categories (never the raw flagged content) go into the audit metadata. Only
 * `passed`/`blocked` are valid transitions — `pending` is the insert-time
 * default, never set here.
 */
export async function setModerationStatus(
  ctx: AuthCtx,
  id: string,
  status: Extract<ModerationStatus, "passed" | "blocked">,
  meta: { reason?: string | null; categories?: readonly string[] } = {},
): Promise<void> {
  const asset = await getMediaById(ctx, id);
  const [updated] = await db.batch([
    db
      .update(mediaAssets)
      .set({ moderationStatus: status })
      .where(and(orgScope(ctx, mediaAssets), eq(mediaAssets.id, id)))
      .returning({ id: mediaAssets.id }),
    buildAuditInsert(ctx, {
      action:
        status === "blocked"
          ? "media.moderation_blocked"
          : "media.moderation_passed",
      entityType: "media_asset",
      entityId: id,
      metadata: {
        brandId: asset.brandId,
        source: asset.source,
        ...(meta.reason ? { reason: meta.reason } : {}),
        ...(meta.categories && meta.categories.length > 0
          ? { categories: [...meta.categories] }
          : {}),
      },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("media_asset", id);
}

/**
 * Generated assets that no post version references and are older than
 * `olderThan` — the orphan-cleanup sweep's work list (D4, AGENTS.md §10). Only
 * `source='generated'` (uploads are user-deliberate → never auto-deleted); the
 * grace window (`olderThan`) spares freshly-generated-but-unpicked variants. The
 * correlated NOT EXISTS matches an asset id against every version's media_ids
 * array in the same org. Org-scoped like every read (the sweep builds a per-org
 * system ctx). Returns id + r2Key so the caller removes both row and object.
 */
export async function findOrphanGeneratedAssets(
  ctx: AuthCtx,
  opts: { olderThan: Date; limit?: number },
): Promise<{ id: string; r2Key: string }[]> {
  const query = db
    .select({ id: mediaAssets.id, r2Key: mediaAssets.r2Key })
    .from(mediaAssets)
    .where(
      and(
        orgScope(ctx, mediaAssets),
        eq(mediaAssets.source, "generated"),
        lt(mediaAssets.createdAt, opts.olderThan),
        sql`not exists (select 1 from ${postVersions} where ${postVersions.orgId} = ${mediaAssets.orgId} and ${mediaAssets.id} = any(${postVersions.mediaIds}))`,
      ),
    )
    .orderBy(mediaAssets.createdAt);
  return opts.limit === undefined ? query : query.limit(opts.limit);
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
