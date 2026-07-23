import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/db";
import { member, user } from "@/db/schemas/auth";
import { postVersions, posts } from "@/db/schemas/posts";
import type { PostContent } from "@/lib/validation/posts";
import { parsePostContent } from "@/lib/validation/posts";
import { ForbiddenError, NotFoundError } from "@/server/domain/errors";
import {
  assertCanApprove,
  type PostStatus,
  transition,
} from "@/server/domain/post-state";
import { buildApprovalInsert, nextInternalRound } from "./approvals";
import { buildAuditInsert, recordAuditEvent } from "./audit";
import { getBrandById } from "./brands";
import { getMediaByIds } from "./media";
import { getAllowSelfApproval } from "./org-settings";
import { assertBrandAccess, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Posts DAL (C1 — the composer's persistence). Org-scoped like every module
 * (AGENTS.md §6): ctx first, orgScope in every where-clause, brand access
 * asserted for creators, cross-org reads indistinguishable from not-found.
 *
 * C1 owns only the DRAFT lifecycle — create a draft and edit it while DRAFT.
 * The post-state machine (submit/approve/schedule transitions) is Epic E's
 * src/server/domain/post-state.ts; PUBLISHING/PUBLISHED/FAILED are set only by
 * the Zernio webhook processor + reconciliation sweep (Epic F). No
 * post_platforms rows here — those materialize at schedule time (F1).
 */

/** The member id to attribute a write to, or null for a system ctx. */
function actorMemberId(ctx: AuthCtx): string | null {
  return ctx.role === "system" ? null : ctx.memberId;
}

/**
 * The de-duped union of every platform variant's attached media ids (C4) —
 * written to post_versions.media_ids (the flat logical-ref column D4's
 * orphan-cleanup job reads). Per-platform attachment stays in content.variants;
 * this is the queryable roll-up.
 */
function collectMediaIds(content: PostContent): string[] {
  const ids = new Set<string>();
  for (const variant of Object.values(content.variants)) {
    for (const id of variant?.mediaIds ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Tenancy guard for attached media (C4): every referenced media id must be a
 * real asset in THIS org AND belong to THIS post's brand — a hostile client
 * could otherwise plant a foreign / nonexistent id into content.variants
 * mediaIds. Returns the validated (deduped) id set; 404-shapes any that don't
 * resolve. getMediaByIds is org + brand-access scoped; we additionally pin each
 * asset to the post's brand.
 */
async function validatedMediaIds(
  ctx: AuthCtx,
  brandId: string,
  content: PostContent,
): Promise<string[]> {
  const ids = collectMediaIds(content);
  if (ids.length === 0) return ids;
  const found = await getMediaByIds(ctx, ids);
  const valid = new Set(
    found.filter((a) => a.brandId === brandId).map((a) => a.id),
  );
  for (const id of ids) {
    if (!valid.has(id)) throw new NotFoundError("media_asset", id);
  }
  return ids;
}

export type DraftPost = {
  id: string;
  brandId: string;
  status: string;
  currentVersionId: string | null;
  content: PostContent | null;
};

/**
 * One post by id with its current version's content, org+brand-scoped. Throws
 * NotFoundError (404-shape) for nonexistent, cross-org and unassigned-to-creator
 * alike (AGENTS.md §7). Used for the §7 step-4 scoped fetch and to hydrate the
 * composer's edit form.
 */
export async function getDraftById(
  ctx: AuthCtx,
  postId: string,
): Promise<DraftPost> {
  const [row] = await db
    .select({
      id: posts.id,
      brandId: posts.brandId,
      status: posts.status,
      currentVersionId: posts.currentVersionId,
      content: postVersions.content,
    })
    .from(posts)
    .leftJoin(
      postVersions,
      and(
        orgScope(ctx, postVersions),
        eq(postVersions.id, posts.currentVersionId),
      ),
    )
    .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError("post", postId);
  }
  // Belt-and-suspenders (§6.4): the org filter already guarantees tenancy, but
  // creators are additionally scoped to assigned brands.
  assertBrandAccess(ctx, row.brandId);
  return {
    ...row,
    content: row.content == null ? null : parsePostContent(row.content),
  };
}

/**
 * Create a new DRAFT post with its first content version (C1). Role is gated
 * upstream by authorize("post:create"); this method owns tenancy + the audit
 * pairing. org_id comes from ctx, never input.
 *
 * Case B (dal/audit.ts): the post/version ids are DB-generated (uuidv7), and
 * the version references the post while the post's current_version_id points
 * back at the version — a mutual dependency that a single db.batch can't
 * express — so the three writes run sequentially, audit last.
 */
export async function createDraft(
  ctx: AuthCtx,
  input: { brandId: string; content: PostContent },
): Promise<{ id: string }> {
  assertBrandAccess(ctx, input.brandId);
  // Reject any attached media that isn't this brand's before persisting refs.
  const mediaIds = await validatedMediaIds(ctx, input.brandId, input.content);

  const [post] = await db
    .insert(posts)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId,
      status: "DRAFT",
      createdBy: actorMemberId(ctx),
    })
    .returning({ id: posts.id });
  if (!post) throw new Error("post insert returned no row");

  const [version] = await db
    .insert(postVersions)
    .values({
      orgId: ctx.orgId,
      postId: post.id,
      versionNo: 1,
      content: input.content,
      mediaIds,
      createdBy: actorMemberId(ctx),
    })
    .returning({ id: postVersions.id });
  if (!version) throw new Error("post_version insert returned no row");

  await db
    .update(posts)
    .set({ currentVersionId: version.id })
    .where(and(orgScope(ctx, posts), eq(posts.id, post.id)));

  await recordAuditEvent(ctx, {
    action: "post.create",
    entityType: "post",
    entityId: post.id,
    // Diff of what was created (§6.6) — targets only, never the caption bodies.
    metadata: { brandId: input.brandId, targets: input.content.targets },
  });

  return { id: post.id };
}

/**
 * Edit a post's content (C1 + E1 edit-revert). Immutability contract
 * (schema/§5): a post_versions row is never UPDATEd — each save appends a new
 * version and repoints current_version_id.
 *
 * Editable statuses (E1): DRAFT and CHANGES_REQUESTED. Saving a
 * CHANGES_REQUESTED post runs the §5 `edit` transition back to DRAFT (its
 * approval was bound to the now-superseded version). Any other status is
 * rejected — IN_REVIEW/APPROVED/CLIENT_REVIEW are locked in the composer
 * (recall/unschedule flows are later epics), SCHEDULED+ are Epic F's.
 */
export async function updateDraft(
  ctx: AuthCtx,
  input: { postId: string; content: PostContent },
): Promise<{ id: string }> {
  // Scoped fetch (throws 404 for cross-org / unassigned) + status guard.
  const existing = await getDraftById(ctx, input.postId);
  // Cast: the posts_status_check CHECK guarantees status is a PostStatus token.
  const status = existing.status as PostStatus;
  if (status !== "DRAFT" && status !== "CHANGES_REQUESTED") {
    // 403-shape: the post is visible to the caller, the action is just not
    // allowed in this state (only draft / rejected posts are composable).
    throw new ForbiddenError("Only draft posts can be edited here.");
  }
  // §5: an edit reverts to DRAFT (no-op for an already-DRAFT post). The pure
  // machine validates the edge; the DAL persists the resulting status below.
  const nextStatus = transition(status, "edit");
  // Reject any attached media that isn't this brand's before persisting refs.
  const mediaIds = await validatedMediaIds(
    ctx,
    existing.brandId,
    input.content,
  );

  const [latest] = await db
    .select({ versionNo: postVersions.versionNo })
    .from(postVersions)
    .where(
      and(orgScope(ctx, postVersions), eq(postVersions.postId, input.postId)),
    )
    .orderBy(desc(postVersions.versionNo))
    .limit(1);
  const nextVersionNo = (latest?.versionNo ?? 0) + 1;

  const [version] = await db
    .insert(postVersions)
    .values({
      orgId: ctx.orgId,
      postId: input.postId,
      versionNo: nextVersionNo,
      content: input.content,
      mediaIds,
      createdBy: actorMemberId(ctx),
    })
    .returning({ id: postVersions.id });
  if (!version) throw new Error("post_version insert returned no row");

  await db
    .update(posts)
    .set({ currentVersionId: version.id, status: nextStatus })
    .where(and(orgScope(ctx, posts), eq(posts.id, input.postId)));

  await recordAuditEvent(ctx, {
    action: "post.update",
    entityType: "post",
    entityId: input.postId,
    metadata: {
      versionNo: nextVersionNo,
      targets: input.content.targets,
      // Records the §5 revert so the log shows why status changed on an edit.
      revertedToDraft: status === "CHANGES_REQUESTED",
    },
  });

  return { id: input.postId };
}

/**
 * Post columns needed to evaluate a lifecycle transition (E1): status, brand
 * (for access + the client-approval toggle path), the version the decision
 * binds to (§5), and the author (self-approval rule). Scoped fetch — cross-org /
 * unassigned 404s here (AGENTS.md §7 step 4), before any write.
 */
type PostForTransition = {
  id: string;
  brandId: string;
  status: PostStatus;
  currentVersionId: string | null;
  createdBy: string | null;
};

async function getPostForTransition(
  ctx: AuthCtx,
  postId: string,
): Promise<PostForTransition> {
  const [row] = await db
    .select({
      id: posts.id,
      brandId: posts.brandId,
      status: posts.status,
      currentVersionId: posts.currentVersionId,
      createdBy: posts.createdBy,
    })
    .from(posts)
    .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
    .limit(1);
  if (!row) throw new NotFoundError("post", postId);
  assertBrandAccess(ctx, row.brandId);
  // Cast: the posts_status_check CHECK guarantees status is a PostStatus token.
  return { ...row, status: row.status as PostStatus };
}

/**
 * Submit a DRAFT for internal review (E1): DRAFT → IN_REVIEW. Atomic status
 * update + audit (dal/audit.ts Case A). Gated upstream by post:create
 * (submit ⊂ create, permissions.ts §7); creators submit their assigned-brand
 * posts.
 */
export async function submitPost(
  ctx: AuthCtx,
  input: { postId: string },
): Promise<{ id: string; status: PostStatus }> {
  const post = await getPostForTransition(ctx, input.postId);
  const next = transition(post.status, "submit");
  const [updated] = await db.batch([
    db
      .update(posts)
      .set({ status: next })
      .where(and(orgScope(ctx, posts), eq(posts.id, input.postId)))
      .returning({ id: posts.id }),
    buildAuditInsert(ctx, {
      action: "post.submit",
      entityType: "post",
      entityId: input.postId,
      metadata: { from: post.status, to: next },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("post", input.postId);
  return { id: input.postId, status: next };
}

/**
 * Internal approval (E1): IN_REVIEW → APPROVED, or → CLIENT_REVIEW when the
 * brand requires client sign-off (D2). Records the decision bound to the post's
 * current version (§5), stamps internal_approved_by, and audits — all atomic in
 * one batch. Enforces the §5 "no approving your own post" rule unless the org
 * opted in (org_settings.allow_self_approval). Gated upstream by post:approve.
 *
 * §13 hotspot: post state-machine transition + a scoping-sensitive write.
 */
export async function approvePost(
  ctx: AuthCtx,
  input: { postId: string; note?: string | null },
): Promise<{ id: string; status: PostStatus }> {
  const post = await getPostForTransition(ctx, input.postId);
  if (!post.currentVersionId) {
    // A submitted post always has a version; treat the impossible as not-found.
    throw new NotFoundError("post_version", input.postId);
  }
  const brand = await getBrandById(ctx, post.brandId);
  const allowSelfApproval = await getAllowSelfApproval(ctx);
  assertCanApprove({
    isOwnPost: post.createdBy !== null && post.createdBy === actorMemberId(ctx),
    allowSelfApproval,
  });
  const next = transition(post.status, "approve", {
    requiresClientApproval: brand.requiresClientApproval,
  });
  const round = await nextInternalRound(ctx, input.postId);
  const [updated] = await db.batch([
    db
      .update(posts)
      .set({ status: next, internalApprovedBy: actorMemberId(ctx) })
      .where(and(orgScope(ctx, posts), eq(posts.id, input.postId)))
      .returning({ id: posts.id }),
    buildApprovalInsert(ctx, {
      postId: input.postId,
      postVersionId: post.currentVersionId,
      decision: "approved",
      round,
      note: input.note,
    }),
    buildAuditInsert(ctx, {
      action: "post.approve",
      entityType: "post",
      entityId: input.postId,
      metadata: { from: post.status, to: next, round },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("post", input.postId);
  return { id: input.postId, status: next };
}

/**
 * Internal request-changes (E1): IN_REVIEW → CHANGES_REQUESTED with a required
 * note. Records the decision bound to the current version + audits, atomic.
 * Gated upstream by post:approve (request-changes ⊂ approve, permissions.ts §7).
 *
 * §13 hotspot: post state-machine transition + a scoping-sensitive write.
 */
export async function requestChanges(
  ctx: AuthCtx,
  input: { postId: string; note: string },
): Promise<{ id: string; status: PostStatus }> {
  const post = await getPostForTransition(ctx, input.postId);
  if (!post.currentVersionId) {
    throw new NotFoundError("post_version", input.postId);
  }
  const next = transition(post.status, "request_changes");
  const round = await nextInternalRound(ctx, input.postId);
  const [updated] = await db.batch([
    db
      .update(posts)
      .set({ status: next })
      .where(and(orgScope(ctx, posts), eq(posts.id, input.postId)))
      .returning({ id: posts.id }),
    buildApprovalInsert(ctx, {
      postId: input.postId,
      postVersionId: post.currentVersionId,
      decision: "changes_requested",
      round,
      note: input.note,
    }),
    buildAuditInsert(ctx, {
      action: "post.request_changes",
      entityType: "post",
      entityId: input.postId,
      metadata: { from: post.status, to: next, round },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("post", input.postId);
  return { id: input.postId, status: next };
}

/**
 * Posts awaiting a decision for a brand (E1 reviewer UI): IN_REVIEW (actionable
 * internally) + CLIENT_REVIEW (read-only "waiting on client" — E4 acts on it).
 * Org+brand scoped; hydrates each post's current-version content + author name
 * for the queue card. E2 owns filters + the cross-brand "needs my approval"
 * view; this is deliberately the single-brand list.
 */
export type ReviewPost = {
  id: string;
  status: PostStatus;
  content: PostContent | null;
  createdAt: Date;
  createdByName: string | null;
};

export async function listPostsForReview(
  ctx: AuthCtx,
  brandId: string,
): Promise<ReviewPost[]> {
  assertBrandAccess(ctx, brandId);
  const rows = await db
    .select({
      id: posts.id,
      status: posts.status,
      content: postVersions.content,
      createdAt: posts.createdAt,
      createdByName: user.name,
    })
    .from(posts)
    .leftJoin(
      postVersions,
      and(
        orgScope(ctx, postVersions),
        eq(postVersions.id, posts.currentVersionId),
      ),
    )
    .leftJoin(member, eq(member.id, posts.createdBy))
    .leftJoin(user, eq(user.id, member.userId))
    .where(
      and(
        orgScope(ctx, posts),
        eq(posts.brandId, brandId),
        inArray(posts.status, ["IN_REVIEW", "CLIENT_REVIEW"]),
      ),
    )
    .orderBy(desc(posts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    // Cast: the posts_status_check CHECK guarantees a PostStatus token.
    status: r.status as PostStatus,
    content: r.content == null ? null : parsePostContent(r.content),
    createdAt: r.createdAt,
    createdByName: r.createdByName,
  }));
}
