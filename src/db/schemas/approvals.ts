import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
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
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
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
    uniqueIndex("portal_tokens_hash_uidx").on(t.tokenHash),
    index("portal_tokens_org_brand_idx").on(t.orgId, t.brandId),
  ],
);

/**
 * approvals (PRD §4/§5) — immutable decision records (no updated_at).
 * Each decision binds to the post_version it was made against (§5).
 * Exactly one decider in practice (member for 'internal', token for
 * 'client'); the CHECK allows <= 1 so SET NULL on member/token removal
 * preserves history — flagged in PR notes.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    postVersionId: uuid("post_version_id")
      .notNull()
      .references(() => postVersions.id, { onDelete: "cascade" }),
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
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
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
    index("comments_org_post_idx").on(t.orgId, t.postId),
    index("comments_post_created_idx").on(t.postId, t.createdAt),
  ],
);

export const approvalsRelations = defineRelationsPart(
  { portalTokens, approvals, comments, brands, posts, postVersions, member },
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
    },
  }),
);
