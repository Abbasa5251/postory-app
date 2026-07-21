import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { postVersions, posts } from "@/db/schemas/posts";
import type { PostContent } from "@/lib/validation/posts";
import { parsePostContent } from "@/lib/validation/posts";
import { ForbiddenError, NotFoundError } from "@/server/domain/errors";
import { recordAuditEvent } from "./audit";
import { getMediaByIds } from "./media";
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
 * Edit a DRAFT post's content (C1). Immutability contract (schema/§5): a
 * post_versions row is never UPDATEd — each save appends a new version and
 * repoints current_version_id. Editing is DRAFT-only in C1; other statuses are
 * the domain of Epic E's state machine (submit/approve reset-to-draft), so a
 * non-DRAFT post is rejected here.
 */
export async function updateDraft(
  ctx: AuthCtx,
  input: { postId: string; content: PostContent },
): Promise<{ id: string }> {
  // Scoped fetch (throws 404 for cross-org / unassigned) + status guard.
  const existing = await getDraftById(ctx, input.postId);
  if (existing.status !== "DRAFT") {
    // 403-shape: the post is visible to the caller, the action is just not
    // allowed in this state (Epic E owns non-DRAFT edits).
    throw new ForbiddenError("Only draft posts can be edited here.");
  }
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
    .set({ currentVersionId: version.id })
    .where(and(orgScope(ctx, posts), eq(posts.id, input.postId)));

  await recordAuditEvent(ctx, {
    action: "post.update",
    entityType: "post",
    entityId: input.postId,
    metadata: { versionNo: nextVersionNo, targets: input.content.targets },
  });

  return { id: input.postId };
}
