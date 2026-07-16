import { defineRelationsPart, sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { brands } from "./brands";
import { memberRef, orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * generation_jobs (PRD §4, ADR-003/-012) — one row per AI generation run,
 * executed inside Inngest workers, never request handlers. Credits are
 * reserved BEFORE the OpenRouter call and settled/refunded after (ADR-005);
 * the reserved/settled columns here mirror the credit_ledger entries for
 * job-level display, the ledger stays the source of truth.
 */
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    // 'video' reserved for post-launch (D4/D7) — pipeline is model-agnostic.
    type: text("type").notNull(),
    // OpenRouter model id — priced via the credit_rates config table (ADR-012).
    modelId: text("model_id").notNull(),
    prompt: text("prompt"),
    // Opaque — model params (aspect ratio, variant count, …), shaped by Epic D.
    params: jsonb("params"),
    status: text("status").notNull().default("queued"),
    creditsReserved: integer("credits_reserved").notNull().default(0),
    creditsSettled: integer("credits_settled"),
    providerGenerationId: text("provider_generation_id"),
    error: text("error"),
    createdBy: memberRef("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      "generation_jobs_type_check",
      sql`${t.type} IN ('copy', 'image', 'video')`,
    ),
    check(
      "generation_jobs_status_check",
      sql`${t.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    // Composite FK: the job's brand must belong to the job's org (§6).
    foreignKey({
      name: "generation_jobs_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    index("generation_jobs_org_brand_created_idx").on(
      t.orgId,
      t.brandId,
      t.createdAt,
    ),
    index("generation_jobs_org_status_idx").on(t.orgId, t.status),
  ],
);

/**
 * media_assets (PRD §4, ADR-007) — R2-backed media per brand. PRD's
 * "type (image/video/upload)" conflates two axes; split into kind (what it
 * is) and source (where it came from) — flagged in PR notes.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    // ADR-007 key layout: org/{orgId}/brand/{brandId}/…
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    sourceModel: text("source_model"),
    // SET NULL: assets outlive job-row pruning. Single-column FK by
    // necessity: a same-brand composite tie would SET NULL the NOT NULL
    // brand_id on job pruning — flagged in PR notes.
    generationJobId: uuid("generation_job_id").references(
      () => generationJobs.id,
      { onDelete: "set null" },
    ),
    // D5: moderation blocks + logs before an asset becomes usable.
    moderationStatus: text("moderation_status").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [
    check("media_assets_kind_check", sql`${t.kind} IN ('image', 'video')`),
    check(
      "media_assets_source_check",
      sql`${t.source} IN ('upload', 'generated')`,
    ),
    check(
      "media_assets_moderation_status_check",
      sql`${t.moderationStatus} IN ('pending', 'passed', 'blocked')`,
    ),
    // Composite FK: the asset's brand must belong to the asset's org (§6).
    foreignKey({
      name: "media_assets_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    uniqueIndex("media_assets_r2_key_uidx").on(t.r2Key),
    index("media_assets_org_brand_created_idx").on(
      t.orgId,
      t.brandId,
      t.createdAt,
    ),
  ],
);

export const mediaRelations = defineRelationsPart(
  { generationJobs, mediaAssets, brands },
  (r) => ({
    generationJobs: {
      brand: r.one.brands({
        from: r.generationJobs.brandId,
        to: r.brands.id,
      }),
      mediaAssets: r.many.mediaAssets({
        from: r.generationJobs.id,
        to: r.mediaAssets.generationJobId,
      }),
    },
    mediaAssets: {
      brand: r.one.brands({
        from: r.mediaAssets.brandId,
        to: r.brands.id,
      }),
      generationJob: r.one.generationJobs({
        from: r.mediaAssets.generationJobId,
        to: r.generationJobs.id,
      }),
    },
  }),
);
