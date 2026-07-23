import "server-only";
import { toPlainText } from "@/lib/mentions";
import type { PostContent } from "@/lib/validation/posts";
import { env } from "@/lib/env/server";
import { getSystemCtx } from "@/server/auth/context";
import { listBrandMemberIds } from "@/server/dal/brand-members";
import { getBrandById } from "@/server/dal/brands";
import { getCommentById } from "@/server/dal/comments";
import {
  getMembersByIds,
  getPostAuthor,
  listOrgReviewers,
  type NotifyRecipient,
} from "@/server/dal/org";
import { getDraftById } from "@/server/dal/posts";
import {
  sendMentionEmail,
  sendPostApprovedEmail,
  sendPostChangesRequestedEmail,
  sendPostSubmittedEmail,
} from "@/server/services/email/notification-emails";
import { log } from "@/server/services/observability";
import { inngest } from "../client";
import { postNotificationEvent } from "../events";

const JOB_NAME = "post/notification.requested";

/** First target's caption — the email's quoted excerpt. */
function firstCaption(content: PostContent | null): string {
  if (!content) return "";
  const platform = content.targets[0];
  return platform ? (content.variants[platform]?.caption ?? "") : "";
}

/**
 * Post notification fan-out (E3). Turns a `post/notification.requested` event
 * (submit/approve/request-changes/mention) into emails, off the request path
 * (§16 / ADR-003). Runs under a per-org system ctx and resolves everything from
 * the org-scoped DAL — the payload only carries trusted ids (§6).
 *
 * Recipients by kind: submitted → the org's reviewers; approved /
 * changes_requested → the post author; mention → the mentioned members. The
 * actor is always excluded from their own event. Each send is its own
 * best-effort `step.run` (memoized, so a retry never re-sends a delivered
 * email), and a single bad address is logged, not fatal — one recipient can't
 * block the rest.
 */
export const postNotificationJob = inngest.createFunction(
  {
    id: "post-notification",
    retries: 2,
    concurrency: { key: "event.data.orgId", limit: 5 },
    triggers: [postNotificationEvent],
  },
  async ({ event, step }) => {
    const data = event.data;
    const ctx = getSystemCtx(data.orgId, JOB_NAME);

    const prepared = await step.run("prepare", async () => {
      const [brand, post] = await Promise.all([
        getBrandById(ctx, data.brandId),
        getDraftById(ctx, data.postId),
      ]);

      // Actor display name (the person who triggered the event).
      const actorName = data.actorMemberId
        ? ((await getMembersByIds(ctx, [data.actorMemberId]))[0]?.name ??
          "A teammate")
        : "A teammate";

      // Recipients by kind, with the actor removed.
      let recipients: NotifyRecipient[];
      switch (data.kind) {
        case "submitted": {
          // Reviewers ASSIGNED to this brand (brand_members) — mirrors the E2
          // approvals surface, which scopes reviewer visibility to assignments
          // for every role. Emailing an unassigned reviewer would land them on
          // an empty queue (and leak the caption excerpt), so intersect.
          const [reviewers, assignedIds] = await Promise.all([
            listOrgReviewers(ctx),
            listBrandMemberIds(ctx, data.brandId),
          ]);
          const assigned = new Set(assignedIds);
          recipients = reviewers.filter((r) => assigned.has(r.memberId));
          break;
        }
        case "approved":
        case "changes_requested": {
          const author = await getPostAuthor(ctx, data.postId);
          recipients = author ? [author] : [];
          break;
        }
        case "mention":
          recipients = await getMembersByIds(
            ctx,
            data.mentionedMemberIds ?? [],
          );
          break;
      }
      recipients = recipients.filter((r) => r.memberId !== data.actorMemberId);

      const commentExcerpt =
        data.kind === "mention" && data.commentId
          ? toPlainText((await getCommentById(ctx, data.commentId))?.body ?? "")
          : "";

      return {
        brandName: brand.name,
        captionExcerpt: firstCaption(post.content),
        actorName,
        recipients,
        commentExcerpt,
      };
    });

    // App links reuse BETTER_AUTH_URL (the app base — no separate APP_URL env).
    const approvalsUrl = `${env.BETTER_AUTH_URL}/approvals`;
    const composerUrl = `${env.BETTER_AUTH_URL}/brands/${data.brandId}/composer?post=${data.postId}`;

    let sent = 0;
    for (const recipient of prepared.recipients) {
      const ok = await step.run(`send-${recipient.memberId}`, async () => {
        try {
          switch (data.kind) {
            case "submitted":
              await sendPostSubmittedEmail({
                to: recipient.email,
                brandName: prepared.brandName,
                submittedByName: prepared.actorName,
                captionExcerpt: prepared.captionExcerpt,
                url: approvalsUrl,
              });
              break;
            case "approved":
              await sendPostApprovedEmail({
                to: recipient.email,
                brandName: prepared.brandName,
                approvedByName: prepared.actorName,
                captionExcerpt: prepared.captionExcerpt,
                note: data.note,
                url: composerUrl,
              });
              break;
            case "changes_requested":
              await sendPostChangesRequestedEmail({
                to: recipient.email,
                brandName: prepared.brandName,
                requestedByName: prepared.actorName,
                note: data.note ?? "",
                url: composerUrl,
              });
              break;
            case "mention":
              await sendMentionEmail({
                to: recipient.email,
                brandName: prepared.brandName,
                mentionedByName: prepared.actorName,
                commentExcerpt: prepared.commentExcerpt,
                url: composerUrl,
              });
              break;
          }
          return true;
        } catch (error) {
          // Best-effort: a single bad address / provider blip is logged, not
          // fatal — the rest of the recipients still get their email.
          log.warn("post notification email failed", {
            event: "post.notification.send_failed",
            kind: data.kind,
            orgId: data.orgId,
            postId: data.postId,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      });
      if (ok) sent += 1;
    }

    log.info("post notification sent", {
      event: "post.notification",
      kind: data.kind,
      orgId: data.orgId,
      postId: data.postId,
      recipients: prepared.recipients.length,
      sent,
    });
    return { kind: data.kind, recipients: prepared.recipients.length, sent };
  },
);
