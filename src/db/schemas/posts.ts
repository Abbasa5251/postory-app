import { defineRelationsPart, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { member } from "./auth";
import { brands, socialAccounts } from "./brands";
import { createdAt, memberRef, orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * posts (PRD §4/§5) — the core entity. Status tokens are EXACTLY the PRD §5
 * state-machine states (uppercase, unlike other tables' statuses, which are
 * ours to name): DB strings ≡ post-state.ts machine tokens, no mapping layer.
 *
 * Rules enforced in src/server/domain/post-state.ts (Epic E), not here:
 * PUBLISHING/PUBLISHED/FAILED set only by the Zernio webhook processor +
 * reconciliation sweep; any content edit after internal approval reverts to
 * DRAFT; approvals bind to a post_version id.
 *
 * PRD §4 lists a "client decision ref" column — deliberately omitted: the
 * latest `approvals` row (stage='client') is the source of truth per §5, and
 * a posts → approvals FK would add a second, cross-domain circular
 * dependency. Flagged in PR notes.
 */
export const posts = pgTable(
  "posts",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("DRAFT"),
    // Circular FK with post_versions — the AnyPgColumn-annotated thunk breaks
    // the type-inference cycle; drizzle-kit emits FKs as trailing ALTERs, so
    // both constraints land cleanly in one migration. Nullable: the post row
    // exists before its first version.
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => postVersions.id,
      { onDelete: "set null" },
    ),
    createdBy: memberRef("created_by"),
    internalApprovedBy: memberRef("internal_approved_by"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    // Brand IANA timezone snapshot taken at schedule time (AGENTS.md §9).
    scheduledTz: text("scheduled_tz"),
    // ADR-001: Zernio post created only at schedule time; id persisted here.
    zernioPostId: text("zernio_post_id"),
    // Opaque — per-platform publish outcome payload, shaped by Epic F.
    publishResult: jsonb("publish_result"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    check(
      "posts_status_check",
      sql`${t.status} IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLIENT_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED')`,
    ),
    // Nullable-unique: PG treats NULLs as distinct, so unscheduled posts coexist.
    uniqueIndex("posts_zernio_post_uidx").on(t.zernioPostId),
    index("posts_org_brand_created_idx").on(t.orgId, t.brandId, t.createdAt),
    index("posts_org_status_idx").on(t.orgId, t.status),
    index("posts_org_scheduled_idx").on(t.orgId, t.scheduledFor),
  ],
);

/**
 * post_versions (PRD §4) — immutable content snapshots (no updated_at, no
 * UPDATEs by contract). Approvals bind to a version id (§5): any edit
 * creates a new version and reverts the post to DRAFT.
 */
export const postVersions = pgTable(
  "post_versions",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    // Opaque — per-platform content snapshot, shaped by Epic C.
    content: jsonb("content").notNull(),
    // Logical refs → media_assets.id; PG can't enforce FKs inside arrays,
    // orphan handling is D4's asset-cleanup job.
    mediaIds: uuid("media_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdBy: memberRef("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("post_versions_post_no_uidx").on(t.postId, t.versionNo),
    index("post_versions_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * post_platforms (PRD §4) — one row per (post, connected account) target.
 * publish_status is the per-platform slice of the post lifecycle; like
 * posts.status, the terminal values are set only by the webhook processor +
 * reconciliation sweep (Epic F).
 */
export const postPlatforms = pgTable(
  "post_platforms",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    // Opaque — first comment, reel/short type, etc. (C1/C5).
    overrides: jsonb("overrides"),
    publishStatus: text("publish_status").notNull().default("pending"),
    publishError: text("publish_error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      "post_platforms_publish_status_check",
      sql`${t.publishStatus} IN ('pending', 'publishing', 'published', 'failed')`,
    ),
    uniqueIndex("post_platforms_post_account_uidx").on(
      t.postId,
      t.socialAccountId,
    ),
    index("post_platforms_org_status_idx").on(t.orgId, t.publishStatus),
  ],
);

export const postsRelations = defineRelationsPart(
  { posts, postVersions, postPlatforms, brands, socialAccounts, member },
  (r) => ({
    posts: {
      brand: r.one.brands({
        from: r.posts.brandId,
        to: r.brands.id,
      }),
      currentVersion: r.one.postVersions({
        from: r.posts.currentVersionId,
        to: r.postVersions.id,
      }),
      versions: r.many.postVersions({
        from: r.posts.id,
        to: r.postVersions.postId,
      }),
      platforms: r.many.postPlatforms({
        from: r.posts.id,
        to: r.postPlatforms.postId,
      }),
      createdByMember: r.one.member({
        from: r.posts.createdBy,
        to: r.member.id,
      }),
    },
    postVersions: {
      post: r.one.posts({
        from: r.postVersions.postId,
        to: r.posts.id,
      }),
    },
    postPlatforms: {
      post: r.one.posts({
        from: r.postPlatforms.postId,
        to: r.posts.id,
      }),
      socialAccount: r.one.socialAccounts({
        from: r.postPlatforms.socialAccountId,
        to: r.socialAccounts.id,
      }),
    },
  }),
);
