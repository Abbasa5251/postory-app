"use server";

import { revalidatePath } from "next/cache";
import {
  approvePostSchema,
  requestChangesSchema,
  saveDraftSchema,
  submitPostSchema,
} from "@/lib/validation/posts";
import { getBrandById } from "@/server/dal/brands";
import {
  approvePost as approvePostDal,
  createDraft,
  getDraftById,
  requestChanges as requestChangesDal,
  submitPost as submitPostDal,
  updateDraft,
} from "@/server/dal/posts";
import { withAction } from "./with-action";

/**
 * Revalidate the brand surfaces a post transition can affect: the composer
 * (edit lock changes), the posts list, and the approvals queue.
 */
function revalidatePostSurfaces(brandId: string): void {
  revalidatePath(`/brands/${brandId}/composer`);
  revalidatePath(`/brands/${brandId}/posts`);
  revalidatePath(`/brands/${brandId}/approvals`);
}

/**
 * Post server actions (C1). Authored through `withAction` (ADR-013 / §7): the
 * wrapper validates, authenticates, and authorizes; the handler owns the scoped
 * DAL calls (which pair their own audit), then revalidates.
 *
 * `post:create` covers create ⊃ edit (permissions.ts §7), so one gate guards
 * both branches. Scheduling/publishing and the approval transitions are later
 * epics — save-draft is an ordinary mutation, not the async ADR-003 workload.
 */
export const saveDraft = withAction(
  saveDraftSchema,
  "post:create",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch: a cross-org / unassigned brand 404s here before
    // any write (the DAL's own org+brand scope is belt-and-suspenders on top).
    await getBrandById(ctx, data.brandId);

    const result = data.postId
      ? // Edit: getDraftById inside updateDraft re-scopes + guards DRAFT status.
        await updateDraft(ctx, { postId: data.postId, content: data.content })
      : await createDraft(ctx, {
          brandId: data.brandId,
          content: data.content,
        });

    revalidatePath(`/brands/${data.brandId}/composer`);
    revalidatePath(`/brands/${data.brandId}/posts`);
    // Minimal data — never raw rows with other-tenant refs (§7).
    return { id: result.id };
  },
);

/**
 * Submit a draft for internal review (E1): DRAFT → IN_REVIEW. `post:create`
 * covers submit (permissions.ts §7). The DAL runs the §5 state machine + audit;
 * the action does the step-4 scoped fetch (which yields the brandId to
 * revalidate) and 404s a cross-org / unassigned post before any write.
 */
export const submitPost = withAction(
  submitPostSchema,
  "post:create",
  async (data, ctx) => {
    const post = await getDraftById(ctx, data.postId);
    const result = await submitPostDal(ctx, { postId: data.postId });
    revalidatePostSurfaces(post.brandId);
    return { id: result.id, status: result.status };
  },
);

/**
 * Internal approval (E1): IN_REVIEW → APPROVED | CLIENT_REVIEW (per the brand's
 * client-approval toggle). `post:approve` gates it; the DAL enforces the §5
 * "no self-approval" rule and records the decision + audit atomically.
 */
export const approvePost = withAction(
  approvePostSchema,
  "post:approve",
  async (data, ctx) => {
    const post = await getDraftById(ctx, data.postId);
    const result = await approvePostDal(ctx, {
      postId: data.postId,
      note: data.note,
    });
    revalidatePostSurfaces(post.brandId);
    return { id: result.id, status: result.status };
  },
);

/**
 * Internal request-changes (E1): IN_REVIEW → CHANGES_REQUESTED with a required
 * note. `post:approve` covers request-changes (permissions.ts §7).
 */
export const requestChanges = withAction(
  requestChangesSchema,
  "post:approve",
  async (data, ctx) => {
    const post = await getDraftById(ctx, data.postId);
    const result = await requestChangesDal(ctx, {
      postId: data.postId,
      note: data.note,
    });
    revalidatePostSurfaces(post.brandId);
    return { id: result.id, status: result.status };
  },
);
