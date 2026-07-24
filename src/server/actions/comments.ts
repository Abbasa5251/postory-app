"use server";

import {
  createCommentSchema,
  resolveCommentSchema,
} from "@/lib/validation/comments";
import {
  createComment as createCommentDal,
  resolveComment as resolveCommentDal,
} from "@/server/dal/comments";
import { inngest } from "@/server/jobs/client";
import { postNotificationEvent } from "@/server/jobs/events";
import { log } from "@/server/services/observability";
import { revalidatePostSurfaces } from "./revalidate";
import { withAction } from "./with-action";

/**
 * Comment server actions (E3). Authored through `withAction` (ADR-013 / §7):
 * the wrapper validates, authenticates, and authorizes; the DAL owns tenancy +
 * audit. `post:create` gates both — everyone who can work on a post can comment
 * (brand access is enforced in the DAL for creators). @mentions are derived from
 * the body in the DAL and validated against the org before any email fires.
 */
export const createComment = withAction(
  createCommentSchema,
  "post:create",
  async (data, ctx) => {
    const result = await createCommentDal(ctx, {
      postId: data.postId,
      body: data.body,
    });

    // Off-request mention emails (§16 / ADR-003) — only when someone was
    // actually mentioned (validated ids from the DAL). Best-effort: a failed
    // enqueue never fails the comment the user already posted.
    if (result.mentionedMemberIds.length > 0) {
      try {
        await inngest.send(
          postNotificationEvent.create(
            {
              kind: "mention",
              orgId: ctx.orgId,
              postId: data.postId,
              brandId: result.brandId,
              actorMemberId: ctx.memberId,
              commentId: result.id,
              mentionedMemberIds: result.mentionedMemberIds,
            },
            { id: `notify:mention:${result.id}` },
          ),
        );
      } catch (error) {
        log.error("failed to enqueue mention notification", {
          event: "post.notification.enqueue_failed",
          kind: "mention",
          postId: data.postId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    revalidatePostSurfaces(result.brandId);
    return { id: result.id };
  },
);

export const resolveComment = withAction(
  resolveCommentSchema,
  "post:create",
  async (data, ctx) => {
    const result = await resolveCommentDal(ctx, {
      commentId: data.commentId,
      resolved: data.resolved,
    });
    revalidatePostSurfaces(result.brandId);
    return { id: result.id, resolved: result.resolved };
  },
);
