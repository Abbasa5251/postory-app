"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";
import { resolveMediaAssets } from "@/lib/platforms/preview";
import { cn } from "@/lib/utils";
import type { CommentView } from "@/server/dal/comments";
import type { ReviewPost } from "@/server/dal/posts";
import { approvePost, requestChanges } from "@/server/actions/posts";
import { CommentThread } from "../comments/comment-thread";
import type { MentionMember } from "../comments/mention-textarea";
import type { MediaAssetView } from "../composer/media-types";
import { PostPreview, type PreviewIdentity } from "../composer/post-preview";

/** Per-brand → per-platform identity (the queue spans brands — E2). */
type Identities = Record<string, Record<Platform, PreviewIdentity>>;

/** Identity for a post's platform, with a safe fallback for a brand/platform gap. */
function identityFor(
  identities: Identities,
  brandId: string,
  platform: Platform,
  fallbackName: string,
): PreviewIdentity {
  return (
    identities[brandId]?.[platform] ?? {
      handle: null,
      avatarUrl: null,
      name: fallbackName,
    }
  );
}

/** First target's caption (trimmed) — the collapsed list-row title. */
function rowCaption(post: ReviewPost): string {
  const platform = post.content?.targets[0];
  const caption = platform
    ? (post.content?.variants[platform]?.caption ?? "")
    : "";
  return caption.trim();
}

/** Distinct attached media across all platform variants (§4 collectMediaIds mirror). */
function mediaIds(post: ReviewPost): string[] {
  const ids = new Set<string>();
  for (const variant of Object.values(post.content?.variants ?? {})) {
    for (const id of variant?.mediaIds ?? []) ids.add(id);
  }
  return [...ids];
}

// UTC so server + client format the same instant identically (no hydration
// mismatch); date-only keeps it stable. createdAt stands in for submit time
// until a dedicated submittedAt is tracked.
const SUBMITTED_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Cross-brand reviewer queue (E2 — the "needs my approval" queue behind the
 * top-level /approvals route, with the workspace + platform filters in the
 * header). Cards match the postory-design Approvals mockup: striped media
 * thumbnail, platform dots + the post's workspace + a "Pending approval" pill, a
 * 2-line caption, a submitter meta line, and inline Approve / Request-changes.
 * Clicking the thumbnail or caption opens a dialog with a feed-accurate preview
 * per platform (tabs) + the full caption, so a reviewer sees what will ship.
 * CLIENT_REVIEW rows are read-only ("waiting on client" — E4). The mutating
 * actions re-enforce post:approve + the state machine.
 */
export function ReviewQueue({
  posts,
  mediaAssets,
  identities,
  commentsByPost,
  membersByBrand,
  canComment,
  canApprove,
}: {
  posts: ReviewPost[];
  mediaAssets: MediaAssetView[];
  identities: Identities;
  commentsByPost: Record<string, CommentView[]>;
  // E3 @mention picker, keyed by brand — each post offers its own brand's team.
  membersByBrand: Record<string, MentionMember[]>;
  canComment: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <ReviewRow
          key={post.id}
          post={post}
          mediaAssets={mediaAssets}
          identities={identities}
          comments={commentsByPost[post.id] ?? []}
          members={membersByBrand[post.brandId] ?? []}
          canComment={canComment}
          canApprove={canApprove}
        />
      ))}
    </div>
  );
}

function ReviewRow({
  post,
  mediaAssets,
  identities,
  comments,
  members,
  canComment,
  canApprove,
}: {
  post: ReviewPost;
  mediaAssets: MediaAssetView[];
  identities: Identities;
  comments: CommentView[];
  members: MentionMember[];
  canComment: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "changes">("idle");

  const targets = post.content?.targets ?? [];
  const ids = mediaIds(post);
  const cover = resolveMediaAssets(ids.slice(0, 1), mediaAssets)[0];
  const caption = rowCaption(post);
  const canAct = canApprove && post.status === "IN_REVIEW";

  const approve = useActionForm(approvePost, {
    onSuccess: () => {
      toast.success("Approved.");
      router.refresh();
    },
  });

  function openPreview() {
    setMode("idle");
    setOpen(true);
  }
  function openChanges() {
    setMode("changes");
    setOpen(true);
  }

  return (
    <div className="flex items-start gap-4 rounded-xl border bg-card p-4">
      <button
        type="button"
        onClick={openPreview}
        className="shrink-0 cursor-pointer rounded-lg"
        aria-label="Preview post"
      >
        <MediaCover asset={cover} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <PlatformDots targets={targets} />
          <span className="text-xs text-muted-foreground">
            {post.brandName}
          </span>
          <StatusPill status={post.status} />
        </div>
        <button
          type="button"
          onClick={openPreview}
          className="mt-2 block w-full text-left"
        >
          <p className="line-clamp-2 text-sm leading-relaxed text-foreground">
            {caption || (
              <span className="text-muted-foreground">Untitled post</span>
            )}
          </p>
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          {post.createdByName ?? "Unknown"} · submitted{" "}
          {SUBMITTED_FMT.format(post.createdAt)}
        </p>
      </div>

      {canAct && (
        <div className="flex shrink-0 flex-col items-stretch gap-2">
          <Button
            type="button"
            disabled={approve.pending}
            onClick={() => void approve.run({ postId: post.id })}
          >
            {approve.pending ? "Approving…" : "Approve"}
          </Button>
          <Button type="button" variant="outline" onClick={openChanges}>
            Request changes
          </Button>
          {approve.message && (
            <p role="alert" className="text-right text-xs text-destructive">
              {approve.message}
            </p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Review post</DialogTitle>
          <DialogDescription className="sr-only">
            Preview each platform and approve or request changes.
          </DialogDescription>
          <ReviewModalBody
            post={post}
            mediaAssets={mediaAssets}
            identities={identities}
            comments={comments}
            members={members}
            canComment={canComment}
          />
          {canAct ? (
            <DialogFooter>
              <ModalActions
                postId={post.id}
                initialMode={mode}
                onDone={() => setOpen(false)}
              />
            </DialogFooter>
          ) : (
            <DialogFooter showCloseButton />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 88px square media thumbnail (image/video) or a striped placeholder (mockup). */
function MediaCover({ asset }: { asset: MediaAssetView | undefined }) {
  if (!asset) {
    return (
      <div
        className="size-22 rounded-[10px] border"
        // Diagonal stripes, token-based so it adapts to dark mode (mockup uses
        // the light canvas neutrals directly).
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--muted) 0 8px, var(--card) 8px 16px)",
        }}
      />
    );
  }
  if (asset.kind === "video") {
    return (
      <video
        src={asset.url}
        className="size-22 rounded-[10px] border object-cover"
        preload="metadata"
        muted
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- list thumbnail, client-side only
    <img
      src={asset.url}
      alt=""
      className="size-22 rounded-[10px] border object-cover"
    />
  );
}

/** Small colored dots for the targeted platforms (single-source colors). */
function PlatformDots({ targets }: { targets: Platform[] }) {
  if (targets.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {targets.map((p) => (
        <span
          key={p}
          className="size-2.5 rounded-full"
          style={{ backgroundColor: PLATFORM_CONFIG[p].color }}
          title={PLATFORM_CONFIG[p].label}
        />
      ))}
    </span>
  );
}

function StatusPill({ status }: { status: ReviewPost["status"] }) {
  const isClient = status === "CLIENT_REVIEW";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
        isClient
          ? "bg-secondary text-secondary-foreground"
          : "bg-status-pending text-status-pending-foreground",
      )}
    >
      {isClient ? "Waiting on client" : "Pending approval"}
    </span>
  );
}

/** Platform tabs → feed-accurate preview + the full caption, per target. */
function ReviewModalBody({
  post,
  mediaAssets,
  identities,
  comments,
  members,
  canComment,
}: {
  post: ReviewPost;
  mediaAssets: MediaAssetView[];
  identities: Identities;
  comments: CommentView[];
  members: MentionMember[];
  canComment: boolean;
}) {
  const targets = post.content?.targets ?? [];
  const [tab, setTab] = useState<Platform | undefined>(targets[0]);

  if (targets.length === 0 || !tab) {
    return <p className="text-sm text-muted-foreground">No content yet.</p>;
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Platform)}>
      {/* Tab bar stays pinned while the preview below scrolls; scrolls
          horizontally when many platforms are targeted. */}
      <TabsList variant="line" className="overflow-x-auto">
        {targets.map((platform) => (
          <TabsTrigger key={platform} value={platform}>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: PLATFORM_CONFIG[platform].color }}
            />
            {PLATFORM_CONFIG[platform].label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* Only the preview area scrolls (bounded to the viewport), so the tab bar
          above and the dialog's footer actions below stay visible on tall posts. */}
      <div className="max-h-[55vh] overflow-y-auto">
        {targets.map((platform) => {
          const variant = post.content?.variants[platform];
          const assets = resolveMediaAssets(variant?.mediaIds, mediaAssets);
          return (
            <TabsContent key={platform} value={platform} className="pt-4">
              <div className="mx-auto max-w-72">
                <PostPreview
                  platform={platform}
                  caption={variant?.caption ?? ""}
                  assets={assets}
                  identity={identityFor(
                    identities,
                    post.brandId,
                    platform,
                    post.brandName,
                  )}
                />
              </div>
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Full caption
                </p>
                <p className="text-sm whitespace-pre-wrap text-foreground">
                  {variant?.caption?.trim() || (
                    <span className="text-muted-foreground">No caption.</span>
                  )}
                </p>
              </div>
            </TabsContent>
          );
        })}
        {/* Post-level discussion (outside TabsContent so it shows on every
            tab) — E3 comments + @mentions + resolve. */}
        <div className="mt-6 border-t pt-4">
          <CommentThread
            postId={post.id}
            comments={comments}
            members={members}
            canComment={canComment}
          />
        </div>
      </div>
    </Tabs>
  );
}

/**
 * Approve + Request-changes inside the review dialog (request-changes reveals a
 * note field in place — no nested dialog). `initialMode` lets the row's inline
 * "Request changes" open straight into the note field. Closes + refreshes on
 * success; failures show inline. The server re-enforces post:approve + §5.
 */
function ModalActions({
  postId,
  initialMode,
  onDone,
}: {
  postId: string;
  initialMode: "idle" | "changes";
  onDone: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "changes">(initialMode);
  const [note, setNote] = useState("");

  const approve = useActionForm(approvePost, {
    onSuccess: () => {
      toast.success("Approved.");
      onDone();
      router.refresh();
    },
  });
  const changes = useActionForm(requestChanges, {
    onSuccess: () => {
      toast.success("Changes requested.");
      onDone();
      router.refresh();
    },
  });

  if (mode === "changes") {
    return (
      <div className="w-full space-y-2">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Tell the creator what to change…"
          aria-label="Change request note"
        />
        {(changes.message || changes.fieldErrors?.note) && (
          <p role="alert" className="text-sm text-destructive">
            {changes.message ?? changes.fieldErrors?.note?.[0]}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={changes.pending}
            onClick={() => setMode("idle")}
          >
            Back
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={changes.pending || note.trim() === ""}
            onClick={() => void changes.run({ postId, note })}
          >
            {changes.pending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMode("changes")}
        >
          Request changes
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={approve.pending}
          onClick={() => void approve.run({ postId })}
        >
          {approve.pending ? "Approving…" : "Approve"}
        </Button>
      </div>
      {approve.message && (
        <p role="alert" className="text-right text-xs text-destructive">
          {approve.message}
        </p>
      )}
    </div>
  );
}
