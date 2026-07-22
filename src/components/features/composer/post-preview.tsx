"use client";

import {
  Bookmark,
  Heart,
  ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Play,
  Repeat2,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { type ComponentType, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";
import {
  getPreviewChrome,
  previewFormatLabel,
  resolvePreviewLayout,
  truncateCaption,
} from "@/lib/platforms/preview";
import { cn } from "@/lib/utils";
import type { MediaAssetView } from "./media-types";
import { PlatformLogo } from "./platform-logo";

/**
 * C5 — feed-accurate preview. A single card that follows the active caption tab
 * (the postory-design mockup) and renders in the active platform's native chrome:
 * a stacked feed card for Instagram/Facebook/LinkedIn/Threads, a full-bleed 9:16
 * frame for the video-first TikTok / YouTube Shorts. Purely presentational — it
 * reads the composer's existing per-platform state; platform identity/colors come
 * from `PLATFORM_CONFIG` and the layout from `getPreviewChrome` (§4, single
 * sources). Approvers (Epic E) see how a post actually reads before it ships.
 */

/** Who the preview attributes the post to (active platform's account, else brand). */
export type PreviewIdentity = {
  /** Connected-account handle for the active platform, if any. */
  handle: string | null;
  /** Connected-account avatar URL, else the brand logo, else null. */
  avatarUrl: string | null;
  /** Brand display name — the header name (LinkedIn/Facebook) + avatar fallback. */
  name: string;
};

type PostPreviewProps = {
  /** The active platform (the caption tab in focus); undefined when no target. */
  platform: Platform | undefined;
  caption: string;
  /** Media attached to the active platform, already resolved + ordered. */
  assets: MediaAssetView[];
  identity: PreviewIdentity;
};

// Feed caption length before the "…more" collapse (feed-accurate; real feeds
// truncate). Generous enough to show intent, short enough to read as a feed.
const FEED_CAPTION_MAX = 140;

type EngagementIcon = ComponentType<{ className?: string }>;

/**
 * Right-rail actions for the vertical layout, per platform — TikTok / YouTube
 * Shorts, plus Instagram / Facebook Reels (a video on those platforms renders as
 * a Reel, not a feed card). Falls back to a generic set.
 */
const VERTICAL_ACTIONS: Partial<Record<Platform, EngagementIcon[]>> = {
  tiktok: [Heart, MessageCircle, Bookmark, Share2],
  youtube: [ThumbsUp, ThumbsDown, MessageCircle, Share2],
  instagram: [Heart, MessageCircle, Send, MoreHorizontal],
  facebook: [ThumbsUp, MessageCircle, Share2, MoreHorizontal],
};
const DEFAULT_VERTICAL_ACTIONS: EngagementIcon[] = [
  Heart,
  MessageCircle,
  Send,
  Bookmark,
];

// Every vertical video format (Reels / TikTok / Shorts) is 9:16.
const VERTICAL_ASPECT = "9 / 16";

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** A stable @handle when no connected account handle exists (brand fallback). */
function fallbackHandle(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "brand";
}

/** One media item (image or video) filling its slide, mirroring the C4 convention. */
function MediaSlide({ asset }: { asset: MediaAssetView }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Once the user starts a video, reveal native controls (play/pause/scrub/mute)
  // and drop the click-to-play overlay.
  const [started, setStarted] = useState(false);

  if (asset.kind === "video") {
    return (
      <>
        <video
          ref={videoRef}
          src={asset.url}
          poster={asset.posterUrl ?? undefined}
          className="size-full object-cover"
          controls={started}
          preload="metadata"
          playsInline
          onPlay={() => setStarted(true)}
        />
        {!started && (
          <button
            type="button"
            aria-label="Play video"
            onClick={() => void videoRef.current?.play()}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white transition-transform hover:scale-105">
              <Play className="size-5 fill-current" />
            </span>
          </button>
        )}
      </>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={asset.url} alt="" className="size-full object-cover" />
  );
}

/**
 * The media frame: a horizontal, swipeable carousel showing EVERY attached asset
 * (like a real feed carousel), with a count badge + dot indicators when there's
 * more than one. Scroll-snap per slide; the active dot tracks scroll position.
 * Empty → an aspect-correct placeholder.
 */
function PreviewMedia({
  assets,
  aspect,
  dark,
}: {
  assets: MediaAssetView[];
  aspect: string;
  dark?: boolean;
}) {
  const [active, setActive] = useState(0);

  if (assets.length === 0) {
    return (
      <div
        style={{ aspectRatio: aspect }}
        className={cn(
          "flex w-full items-center justify-center",
          dark ? "bg-black/85 text-white/50" : "bg-muted text-muted-foreground",
        )}
      >
        <span className="flex flex-col items-center gap-1 text-xs">
          <ImageIcon className="size-5" />
          Media preview
        </span>
      </div>
    );
  }

  const multi = assets.length > 1;
  return (
    <div
      style={{ aspectRatio: aspect }}
      className="relative w-full overflow-hidden bg-muted"
    >
      <div
        // Horizontal scroll-snap track; scrollbar hidden (swipe/drag to move).
        className="flex size-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto scroll-smooth [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        onScroll={
          multi
            ? (e) => {
                const el = e.currentTarget;
                const i = Math.round(el.scrollLeft / el.clientWidth);
                setActive(Math.min(Math.max(i, 0), assets.length - 1));
              }
            : undefined
        }
      >
        {assets.map((asset, i) => (
          <div
            key={asset.id || i}
            className="relative size-full shrink-0 snap-center"
          >
            <MediaSlide asset={asset} />
          </div>
        ))}
      </div>

      {multi && (
        <>
          <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {active + 1}/{assets.length}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {assets.map((asset, i) => (
              <span
                key={asset.id || i}
                className={cn(
                  "size-1.5 rounded-full bg-white drop-shadow transition-opacity",
                  i === active ? "opacity-100" : "opacity-40",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Caption({
  text,
  handle,
  className,
}: {
  text: string;
  /** Prefix the caption with a bold handle (Instagram/Threads feed style). */
  handle?: string;
  className?: string;
}) {
  if (!text.trim()) {
    return (
      <p className={cn("text-muted-foreground italic", className)}>
        Your caption will appear here.
      </p>
    );
  }
  const { text: shown, truncated } = truncateCaption(text, FEED_CAPTION_MAX);
  return (
    <p className={cn("whitespace-pre-wrap", className)}>
      {handle && <span className="font-semibold">{handle} </span>}
      {shown}
      {truncated && <span className="text-muted-foreground"> …more</span>}
    </p>
  );
}

function FeedIconRow({ platform }: { platform: Platform }) {
  // Instagram: left cluster + bookmark on the right. Others: an even bar. Icons
  // are decorative (the brand mark carries identity), so aria-hidden throughout.
  if (platform === "instagram") {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 text-foreground/80">
        <div className="flex items-center gap-4">
          <Heart className="size-5" aria-hidden />
          <MessageCircle className="size-5" aria-hidden />
          <Send className="size-5" aria-hidden />
        </div>
        <Bookmark className="size-5" aria-hidden />
      </div>
    );
  }
  const actions: { icon: EngagementIcon; label: string }[] =
    platform === "linkedin"
      ? [
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageCircle, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ]
      : platform === "threads"
        ? [
            { icon: Heart, label: "Like" },
            { icon: MessageCircle, label: "Reply" },
            { icon: Repeat2, label: "Repost" },
            { icon: Send, label: "Share" },
          ]
        : [
            // facebook
            { icon: ThumbsUp, label: "Like" },
            { icon: MessageCircle, label: "Comment" },
            { icon: Share2, label: "Share" },
          ];
  const labelled = platform !== "threads";
  return (
    <div className="mt-1 flex items-center justify-around border-t px-3 py-3 text-xs font-medium text-muted-foreground">
      {actions.map(({ icon: Icon, label }) => (
        <span key={label} className="flex items-center gap-1.5">
          <Icon className="size-4" aria-hidden />
          {labelled && <span>{label}</span>}
        </span>
      ))}
    </div>
  );
}

function FeedPreview({
  platform,
  caption,
  assets,
  identity,
}: {
  platform: Platform;
  caption: string;
  assets: MediaAssetView[];
  identity: PreviewIdentity;
}) {
  const cfg = PLATFORM_CONFIG[platform];
  const chrome = getPreviewChrome(platform);
  const handle = identity.handle ?? fallbackHandle(identity.name);
  // Name-led header (LinkedIn/Facebook show the page name) vs handle-led (IG/Threads).
  const headline = chrome.showHeadline ? identity.name : `@${handle}`;
  const media = <PreviewMedia assets={assets} aspect={chrome.mediaAspect} />;
  const captionEl = (
    <Caption
      text={caption}
      // IG/Threads prefix the caption with the handle inline; the name-led
      // layouts already show it in the header.
      handle={chrome.showHeadline ? undefined : handle}
      className="px-3 py-2 text-sm leading-snug"
    />
  );

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar size="sm">
          {identity.avatarUrl && (
            <AvatarImage src={identity.avatarUrl} alt="" />
          )}
          <AvatarFallback>{initial(identity.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{headline}</p>
          {chrome.showHeadline && (
            <p className="truncate text-xs text-muted-foreground">Just now</p>
          )}
        </div>
        <span className="shrink-0" style={{ color: cfg.color }}>
          <PlatformLogo platform={platform} className="size-4" />
        </span>
        <MoreHorizontal
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </div>

      {chrome.captionFirst ? (
        <>
          {captionEl}
          {media}
        </>
      ) : (
        <>
          {media}
          <FeedIconRow platform={platform} />
          {captionEl}
        </>
      )}

      {chrome.captionFirst && <FeedIconRow platform={platform} />}
    </div>
  );
}

function VerticalPreview({
  platform,
  caption,
  assets,
  identity,
}: {
  platform: Platform;
  caption: string;
  assets: MediaAssetView[];
  identity: PreviewIdentity;
}) {
  const handle = identity.handle ?? fallbackHandle(identity.name);
  const actions = VERTICAL_ACTIONS[platform] ?? DEFAULT_VERTICAL_ACTIONS;
  return (
    <div
      // Definite width (not `max-w` + `mx-auto`): auto side-margins disable flex
      // `stretch`, which would collapse the width — and with only absolutely
      // positioned children, the aspect-ratio-derived height — to 0.
      className="relative mx-auto w-60 max-w-full overflow-hidden rounded-xl bg-black ring-1 ring-foreground/10"
      style={{ aspectRatio: VERTICAL_ASPECT }}
    >
      <div className="absolute inset-0">
        <PreviewMedia assets={assets} aspect={VERTICAL_ASPECT} dark />
      </div>

      {/* Scrims so overlaid text/icons stay legible over any media. */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Platform brand mark, top-left (identity on the full-bleed frame). */}
      <span className="absolute top-2.5 left-2.5 text-white drop-shadow">
        <PlatformLogo platform={platform} className="size-5" />
      </span>

      {/* Right-rail action stack. */}
      <div className="absolute right-2 bottom-4 flex flex-col items-center gap-4 text-white">
        {actions.map((Icon, i) => (
          <Icon key={i} className="size-6 drop-shadow" aria-hidden />
        ))}
      </div>

      {/* Bottom-left handle + caption overlay. */}
      <div className="absolute inset-x-0 bottom-0 space-y-1 p-3 pr-12 text-white">
        <p className="text-sm font-semibold drop-shadow">@{handle}</p>
        {caption.trim() ? (
          <p className="line-clamp-3 text-xs leading-snug drop-shadow">
            {truncateCaption(caption, FEED_CAPTION_MAX).text}
          </p>
        ) : (
          <p className="text-xs text-white/60 italic drop-shadow">
            Your caption will appear here.
          </p>
        )}
      </div>
    </div>
  );
}

export function PostPreview({
  platform,
  caption,
  assets,
  identity,
}: PostPreviewProps) {
  const label = platform ? PLATFORM_CONFIG[platform].label : null;
  // Layout follows the media, not just the platform. A *single* video on
  // Instagram/Facebook is a Reel (9:16); two+ items — including a mixed
  // image+video set — is a carousel (feed card). Key off the hero (assets[0],
  // the slide PreviewMedia leads with) plus the count.
  const isVideoHero = assets[0]?.kind === "video";
  const layout = platform
    ? resolvePreviewLayout(platform, isVideoHero, assets.length)
    : null;
  const formatLabel =
    platform && layout ? previewFormatLabel(platform, layout) : null;
  return (
    <section aria-label="Post preview" className="flex flex-col gap-2">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
        Preview{label ? ` · ${label}` : ""}
        {formatLabel ? ` · ${formatLabel}` : ""}
      </p>
      {!platform ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Select a platform to preview how your post will look.
        </div>
      ) : layout === "vertical" ? (
        <VerticalPreview
          platform={platform}
          caption={caption}
          assets={assets}
          identity={identity}
        />
      ) : (
        <FeedPreview
          platform={platform}
          caption={caption}
          assets={assets}
          identity={identity}
        />
      )}
    </section>
  );
}
