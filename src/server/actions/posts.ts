"use server";

import { revalidatePath } from "next/cache";
import { saveDraftSchema } from "@/lib/validation/posts";
import { getBrandById } from "@/server/dal/brands";
import { createDraft, updateDraft } from "@/server/dal/posts";
import { withAction } from "./with-action";

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
