import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
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
import { member } from "./auth";
import { brands } from "./brands";
import { posts, postVersions } from "./posts";
import { createdAt, memberRef, orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * portal_tokens (PRD §4, ADR-008) — tokenized client-portal access. Raw
 * tokens are crypto-random, shown once, and only the hash is stored
 * (AGENTS.md §7). Single-brand by design. Portal requests never build an
 * AuthCtx — they get the narrower PortalCtx + dedicated DAL methods (Epic E).
 */
export const portalTokens = pgTable(
  "portal_tokens",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    capability: text("capability").notNull(),
    // Opaque — post-id set ('approve') or brand+month ('report'), shaped by E4/G4.
    scope: jsonb("scope").notNull(),
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Nullable: tokens are also system-issued on CLIENT_REVIEW entry (§5).
    createdBy: memberRef("created_by"),
    ...timestamps(),
  },
  (t) => [
    check(
      "portal_tokens_capability_check",
      sql`${t.capability} IN ('approve', 'report')`,
    ),
    // Composite FK: the token's brand must belong to the token's org (§6
    // belt-and-suspenders — org_id here can never point across tenants).
    foreignKey({
      name: "portal_tokens_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    uniqueIndex("portal_tokens_hash_uidx").on(t.tokenHash),
    index("portal_tokens_org_brand_idx").on(t.orgId, t.brandId),
  ],
);

/**
 * approvals (PRD §4/§5) — immutable decision records (no updated_at).
 * Each decision binds to the post_version it was made against (§5).
 * Decider type is stage-bound (member decides 'internal', token decides
 * 'client' — enforced by approvals_decider_stage_check); both may be NULL
 * so SET NULL on member/token removal preserves history — flagged in PR
 * notes.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postId: uuid("post_id").notNull(),
    postVersionId: uuid("post_version_id").notNull(),
    stage: text("stage").notNull(),
    round: integer("round").notNull().default(1),
    decision: text("decision").notNull(),
    note: text("note"),
    decidedByMemberId: memberRef("decided_by_member_id"),
    decidedByTokenId: uuid("decided_by_token_id").references(
      () => portalTokens.id,
      { onDelete: "set null" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("approvals_stage_check", sql`${t.stage} IN ('internal', 'client')`),
    check(
      "approvals_decision_check",
      sql`${t.decision} IN ('approved', 'changes_requested')`,
    ),
    check(
      "approvals_decided_by_check",
      sql`num_nonnulls(${t.decidedByMemberId}, ${t.decidedByTokenId}) <= 1`,
    ),
    // Decider type follows the stage: only members decide 'internal', only
    // portal tokens decide 'client' (§5/§7). NULLs stay legal (SET NULL).
    check(
      "approvals_decider_stage_check",
      sql`(${t.stage} <> 'internal' OR ${t.decidedByTokenId} IS NULL) AND (${t.stage} <> 'client' OR ${t.decidedByMemberId} IS NULL)`,
    ),
    // Composite FKs: the post must live in this org, and the decided-against
    // version must belong to this post (§6 belt-and-suspenders).
    foreignKey({
      name: "approvals_org_post_fkey",
      columns: [t.orgId, t.postId],
      foreignColumns: [posts.orgId, posts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "approvals_post_version_fkey",
      columns: [t.postId, t.postVersionId],
      foreignColumns: [postVersions.postId, postVersions.id],
    }).onDelete("cascade"),
    index("approvals_org_post_idx").on(t.orgId, t.postId),
    index("approvals_post_stage_round_idx").on(t.postId, t.stage, t.round),
  ],
);

/**
 * comments (PRD §4, E3) — post discussion, from members or portal tokens.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postId: uuid("post_id").notNull(),
    // Opaque — where the comment anchors (platform tab, media, …), shaped by E3.
    anchor: jsonb("anchor"),
    body: text("body").notNull(),
    authorMemberId: memberRef("author_member_id"),
    authorTokenId: uuid("author_token_id").references(() => portalTokens.id, {
      onDelete: "set null",
    }),
    resolved: boolean("resolved").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    check(
      "comments_author_check",
      sql`num_nonnulls(${t.authorMemberId}, ${t.authorTokenId}) <= 1`,
    ),
    // Composite FK: the commented post must live in this org (§6).
    foreignKey({
      name: "comments_org_post_fkey",
      columns: [t.orgId, t.postId],
      foreignColumns: [posts.orgId, posts.id],
    }).onDelete("cascade"),
    index("comments_org_post_idx").on(t.orgId, t.postId),
    index("comments_post_created_idx").on(t.postId, t.createdAt),
  ],
);

/**
 * comment_mentions (PRD §4, E3) — a comment @-mentions org members. A join row
 * per (comment, member) so a future "posts where I'm mentioned" query is a plain
 * index scan. Rows are derived from the comment body; they die with the comment
 * or the member (cascade), never orphaned.
 */
export const commentMentions = pgTable(
  "comment_mentions",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    commentId: uuid("comment_id").notNull(),
    // NOT the nullable memberRef helper: a mention with no target is useless, so
    // the row cascades away with the member (unlike attribution FKs, §6).
    mentionedMemberId: text("mentioned_member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Composite FK: the mentioned comment must live in this org (§6).
    foreignKey({
      name: "comment_mentions_org_comment_fkey",
      columns: [t.orgId, t.commentId],
      foreignColumns: [comments.orgId, comments.id],
    }).onDelete("cascade"),
    uniqueIndex("comment_mentions_comment_member_uidx").on(
      t.commentId,
      t.mentionedMemberId,
    ),
    // Future mentions-inbox: "which comments mention me", org-scoped.
    index("comment_mentions_org_member_idx").on(t.orgId, t.mentionedMemberId),
  ],
);

export const approvalsRelations = defineRelationsPart(
  {
    portalTokens,
    approvals,
    comments,
    commentMentions,
    brands,
    posts,
    postVersions,
    member,
  },
  (r) => ({
    portalTokens: {
      brand: r.one.brands({
        from: r.portalTokens.brandId,
        to: r.brands.id,
      }),
    },
    approvals: {
      post: r.one.posts({
        from: r.approvals.postId,
        to: r.posts.id,
      }),
      postVersion: r.one.postVersions({
        from: r.approvals.postVersionId,
        to: r.postVersions.id,
      }),
      decidedByMember: r.one.member({
        from: r.approvals.decidedByMemberId,
        to: r.member.id,
      }),
      decidedByToken: r.one.portalTokens({
        from: r.approvals.decidedByTokenId,
        to: r.portalTokens.id,
      }),
    },
    comments: {
      post: r.one.posts({
        from: r.comments.postId,
        to: r.posts.id,
      }),
      authorMember: r.one.member({
        from: r.comments.authorMemberId,
        to: r.member.id,
      }),
      authorToken: r.one.portalTokens({
        from: r.comments.authorTokenId,
        to: r.portalTokens.id,
      }),
      mentions: r.many.commentMentions({
        from: r.comments.id,
        to: r.commentMentions.commentId,
      }),
    },
    commentMentions: {
      comment: r.one.comments({
        from: r.commentMentions.commentId,
        to: r.comments.id,
      }),
      mentionedMember: r.one.member({
        from: r.commentMentions.mentionedMemberId,
        to: r.member.id,
      }),
    },
  }),
);
