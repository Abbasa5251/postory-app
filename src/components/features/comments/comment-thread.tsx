"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActionForm } from "@/hooks/use-action-form";
import { buildBodyFromDisplay, splitBody } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { createComment, resolveComment } from "@/server/actions/comments";
import type { CommentView } from "@/server/dal/comments";
import { MentionTextarea, type MentionMember } from "./mention-textarea";

// UTC so server + client render the same instant (no hydration mismatch).
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/**
 * Post comment thread (E3) — discussion + @mentions + resolve. Members-only
 * (portal client comments are E4). Reads a post's comments + the org member list
 * (for the mention typeahead) from the server; writes via the comment actions,
 * refreshing on success so the server re-renders the thread.
 */
export function CommentThread({
  postId,
  comments,
  members,
  canComment,
}: {
  postId: string;
  comments: CommentView[];
  members: MentionMember[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionMember[]>([]);

  const create = useActionForm(createComment, {
    onSuccess: () => {
      setText("");
      setMentions([]);
      toast.success("Comment posted.");
      router.refresh();
    },
  });

  function post() {
    const body = buildBodyFromDisplay(text, [
      ...new Map(
        mentions.map((m) => [m.id, { name: m.name, memberId: m.id }]),
      ).values(),
    ]);
    void create.run({ postId, body });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </p>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              canComment={canComment}
            />
          ))}
        </ul>
      )}

      {canComment && (
        <div className="flex flex-col gap-2">
          <MentionTextarea
            value={text}
            onChange={setText}
            members={members}
            onMention={(m) => setMentions((prev) => [...prev, m])}
            placeholder="Add a comment… use @ to mention a teammate"
            aria-label="Add a comment"
            disabled={create.pending}
          />
          {create.message && (
            <p role="alert" className="text-sm text-destructive">
              {create.message}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={create.pending || text.trim() === ""}
              onClick={post}
            >
              {create.pending ? "Posting…" : "Comment"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  canComment,
}: {
  comment: CommentView;
  canComment: boolean;
}) {
  const router = useRouter();
  const resolve = useActionForm(resolveComment, {
    onSuccess: () => router.refresh(),
  });

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        comment.resolved ? "bg-muted/40" : "bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {comment.authorName ?? "Unknown"}
        </span>
        <span className="text-xs text-muted-foreground">
          {TIME_FMT.format(comment.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
        <CommentBody body={comment.body} />
      </p>
      <div className="mt-2 flex items-center gap-2">
        {comment.resolved && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            Resolved
          </span>
        )}
        {/* Resolve/Reopen is a mutation (post:create) — hide it from a
            read-only viewer; the server action re-enforces regardless. */}
        {canComment && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={resolve.pending}
            onClick={() =>
              void resolve.run({
                commentId: comment.id,
                resolved: !comment.resolved,
              })
            }
          >
            {comment.resolved ? "Reopen" : "Resolve"}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Render a stored body: plain text runs + highlighted `@Name` mentions. */
function CommentBody({ body }: { body: string }) {
  return (
    <>
      {splitBody(body).map((segment, i) =>
        segment.type === "mention" ? (
          <span
            key={i}
            className="rounded bg-primary/10 px-1 font-medium text-primary"
          >
            @{segment.name}
          </span>
        ) : (
          <span key={i}>{segment.value}</span>
        ),
      )}
    </>
  );
}
