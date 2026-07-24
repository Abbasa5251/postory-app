import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/db";
import { commentMentions, comments } from "@/db/schemas/approvals";
import { member, user } from "@/db/schemas/auth";
import { posts } from "@/db/schemas/posts";
import { parseMentionIds } from "@/lib/mentions";
import { NotFoundError } from "@/server/domain/errors";
import { buildAuditInsert } from "./audit";
import { getMembersByIds } from "./org";
import { getDraftById } from "./posts";
import { brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Comments DAL (E3) — post discussion + @-mentions, org-scoped like every
 * module (§6): ctx first, orgScope in every where-clause, brand access asserted
 * for creators (a comment has no brand column, so access is checked through the
 * commented post's brand). Portal-token (client) comments are E4 — this module
 * only handles member-authored comments.
 */

/** The member id to attribute a write to, or null for a system ctx. */
function actorMemberId(ctx: AuthCtx): string | null {
  return ctx.role === "system" ? null : ctx.memberId;
}

export type CommentMention = { memberId: string; name: string | null };

export type CommentView = {
  id: string;
  body: string;
  resolved: boolean;
  createdAt: Date;
  authorMemberId: string | null;
  authorName: string | null;
  mentions: CommentMention[];
};

/**
 * Comments for a set of posts, oldest-first per post, keyed by post id. Batch
 * loader for the cross-brand approvals queue (empty input → no query). Tenancy:
 * orgScope on comments PLUS a scoped `posts` inner join carrying brandScope, so
 * a creator only ever reads comments on their assigned brands (defense-in-depth
 * — the queue already scopes, this stops a widened caller). Mentions are a
 * second scoped read stitched in JS (a one-to-many join would fan out rows).
 */
export async function listCommentsForPosts(
  ctx: AuthCtx,
  postIds: string[],
): Promise<Map<string, CommentView[]>> {
  const byPost = new Map<string, CommentView[]>();
  if (postIds.length === 0) return byPost;

  const rows = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      body: comments.body,
      resolved: comments.resolved,
      createdAt: comments.createdAt,
      authorMemberId: comments.authorMemberId,
      authorName: user.name,
    })
    .from(comments)
    // Scoped join → enables brandScope; the composite FK already pins the
    // comment's post to this org, this adds the creator brand narrowing.
    .innerJoin(posts, and(orgScope(ctx, posts), eq(posts.id, comments.postId)))
    .leftJoin(member, eq(member.id, comments.authorMemberId))
    .leftJoin(user, eq(user.id, member.userId))
    .where(
      and(
        orgScope(ctx, comments),
        inArray(comments.postId, postIds),
        brandScope(ctx, posts.brandId),
      ),
    )
    .orderBy(asc(comments.createdAt));

  const commentIds = rows.map((r) => r.id);
  const mentionsByComment = await mentionsFor(ctx, commentIds);

  for (const row of rows) {
    const view: CommentView = {
      id: row.id,
      body: row.body,
      resolved: row.resolved,
      createdAt: row.createdAt,
      authorMemberId: row.authorMemberId,
      authorName: row.authorName,
      mentions: mentionsByComment.get(row.id) ?? [],
    };
    const list = byPost.get(row.postId);
    if (list) list.push(view);
    else byPost.set(row.postId, [view]);
  }
  return byPost;
}

/**
 * A single comment's body + author, org-scoped (for the notification job's
 * mention excerpt). Returns null if gone / cross-org.
 */
export async function getCommentById(
  ctx: AuthCtx,
  commentId: string,
): Promise<{ body: string; authorMemberId: string | null } | null> {
  const [row] = await db
    .select({ body: comments.body, authorMemberId: comments.authorMemberId })
    .from(comments)
    .where(and(orgScope(ctx, comments), eq(comments.id, commentId)))
    .limit(1);
  return row ?? null;
}

/** One post's comments, oldest-first (thin wrapper over the batch loader). */
export async function listCommentsForPost(
  ctx: AuthCtx,
  postId: string,
): Promise<CommentView[]> {
  const byPost = await listCommentsForPosts(ctx, [postId]);
  return byPost.get(postId) ?? [];
}

/** Mentioned members per comment id (org-scoped), for stitching into views. */
async function mentionsFor(
  ctx: AuthCtx,
  commentIds: string[],
): Promise<Map<string, CommentMention[]>> {
  const map = new Map<string, CommentMention[]>();
  if (commentIds.length === 0) return map;
  const rows = await db
    .select({
      commentId: commentMentions.commentId,
      memberId: commentMentions.mentionedMemberId,
      name: user.name,
    })
    .from(commentMentions)
    .leftJoin(member, eq(member.id, commentMentions.mentionedMemberId))
    .leftJoin(user, eq(user.id, member.userId))
    .where(
      and(
        orgScope(ctx, commentMentions),
        inArray(commentMentions.commentId, commentIds),
      ),
    );
  for (const row of rows) {
    const mention: CommentMention = { memberId: row.memberId, name: row.name };
    const list = map.get(row.commentId);
    if (list) list.push(mention);
    else map.set(row.commentId, [mention]);
  }
  return map;
}

/**
 * Post a comment (E3). @-mentions are derived from the body (§ single source —
 * @/lib/mentions), then validated against THIS org's membership (getMembersByIds
 * drops any cross-org / nonexistent id) before a comment_mentions row is
 * written. Returns the post's brandId (for revalidation) and the validated
 * mentioned member ids (for the notification event).
 *
 * Atomic write (§6.6): the comment id is generated app-side so the comment
 * insert, its mention rows, and the audit row commit in ONE db.batch (a
 * DB-generated id can't be referenced by sibling statements). A v4 id is fine —
 * comments order by created_at, not id. So a mention/audit failure rolls the
 * comment back too; there is never a comment without an audit entry.
 */
export async function createComment(
  ctx: AuthCtx,
  input: { postId: string; body: string; anchor?: unknown },
): Promise<{ id: string; brandId: string; mentionedMemberIds: string[] }> {
  // §7 step-4 scoped fetch: 404s a cross-org / unassigned post before any write
  // and yields the brandId.
  const post = await getDraftById(ctx, input.postId);

  const mentionIds = parseMentionIds(input.body);
  const validMentions = await getMembersByIds(ctx, mentionIds);
  const mentionedMemberIds = validMentions.map((m) => m.memberId);

  const id = randomUUID();
  const commentInsert = db.insert(comments).values({
    id,
    orgId: ctx.orgId,
    postId: input.postId,
    body: input.body,
    anchor: input.anchor ?? null,
    authorMemberId: actorMemberId(ctx),
  });
  const auditInsert = buildAuditInsert(ctx, {
    action: "comment.create",
    entityType: "comment",
    entityId: id,
    metadata: { postId: input.postId, mentionCount: mentionedMemberIds.length },
  });

  if (mentionedMemberIds.length > 0) {
    const mentionInsert = db.insert(commentMentions).values(
      mentionedMemberIds.map((memberId) => ({
        orgId: ctx.orgId,
        commentId: id,
        mentionedMemberId: memberId,
      })),
    );
    await db.batch([commentInsert, mentionInsert, auditInsert]);
  } else {
    await db.batch([commentInsert, auditInsert]);
  }

  return { id, brandId: post.brandId, mentionedMemberIds };
}

/**
 * Toggle a comment's resolved flag (E3). Scoped-fetch the comment (org) → its
 * post (asserts brand access + 404-shape via getDraftById) → atomic update +
 * audit (Case-A batch). Returns the post's brandId for revalidation.
 */
export async function resolveComment(
  ctx: AuthCtx,
  input: { commentId: string; resolved: boolean },
): Promise<{ id: string; resolved: boolean; brandId: string }> {
  const [existing] = await db
    .select({ postId: comments.postId })
    .from(comments)
    .where(and(orgScope(ctx, comments), eq(comments.id, input.commentId)))
    .limit(1);
  if (!existing) throw new NotFoundError("comment", input.commentId);
  // Asserts brand access (creators) + gives the brandId to revalidate.
  const post = await getDraftById(ctx, existing.postId);

  const [updated] = await db.batch([
    db
      .update(comments)
      .set({ resolved: input.resolved })
      .where(and(orgScope(ctx, comments), eq(comments.id, input.commentId)))
      .returning({ id: comments.id }),
    buildAuditInsert(ctx, {
      action: input.resolved ? "comment.resolve" : "comment.unresolve",
      entityType: "comment",
      entityId: input.commentId,
      metadata: { postId: existing.postId },
    }),
  ]);
  if (updated.length === 0) {
    throw new NotFoundError("comment", input.commentId);
  }
  return {
    id: input.commentId,
    resolved: input.resolved,
    brandId: post.brandId,
  };
}
