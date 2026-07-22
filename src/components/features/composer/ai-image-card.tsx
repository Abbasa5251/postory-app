"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { useJobStream } from "@/hooks/use-job-stream";
import {
  IMAGE_ASPECT_PRESETS,
  type ImageAspectPreset,
  imagePresetsForPlatform,
  PLATFORM_CONFIG,
  type Platform,
} from "@/lib/platforms/config";
import { imageChannel } from "@/lib/realtime/image-channel";
import { cn } from "@/lib/utils";
import { generateImage } from "@/server/actions/image";
import type { MediaAssetView } from "./media-types";

/** The generateImage action's success payload (jobId + realtime token). */
type Job = Extract<
  Awaited<ReturnType<typeof generateImage>>,
  { ok: true }
>["data"];

// Labels only — the authoritative per-image credit cost lives in `credit_rates`
// (server-side, read via getActiveRate); the client must not hardcode it or it
// would drift when the rate is tuned (§4). The action fast-fails on insufficient
// balance and surfaces INSUFFICIENT_CREDITS here.
const TIERS = [
  { id: "standard", label: "Standard" },
  { id: "premium", label: "Premium" },
] as const;
type Tier = (typeof TIERS)[number]["id"];

const VARIANT_COUNTS = [2, 3, 4] as const;

type AiImageCardProps = {
  brandId: string;
  /** The composer's active platform tab; the image is seeded/attached for it. */
  platform: Platform | undefined;
  hasVoiceProfile: boolean;
  /** The active platform's caption, offered as a one-click prompt seed. */
  seedCaption: string;
  /** Attach a generated image to the composer (composer's `attachMedia`). */
  onAttach: (asset: MediaAssetView, platforms: Platform[]) => void;
};

export function AiImageCard({
  brandId,
  platform,
  hasVoiceProfile,
  seedCaption,
  onAttach,
}: AiImageCardProps) {
  const [prompt, setPrompt] = useState("");
  const [tier, setTier] = useState<Tier>("standard");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectPreset>("1:1");
  const [variantCount, setVariantCount] = useState<number>(2);
  // The job plus the platform + variant count it was generated FOR, so
  // attaching/rendering stays tied to the submitted request even if the active
  // tab or the count selector changed since.
  const [session, setSession] = useState<{
    job: Job;
    platform: Platform;
    count: number;
  } | null>(null);
  const genPlatform = useRef<Platform | null>(null);
  const genCount = useRef<number>(variantCount);

  const { pending, message, fieldErrors, run } = useActionForm(generateImage, {
    onSuccess: (data: Job) => {
      const target = genPlatform.current;
      if (target)
        setSession({ job: data, platform: target, count: genCount.current });
    },
  });

  function generate() {
    if (!platform) return;
    genPlatform.current = platform;
    genCount.current = variantCount;
    // Remount the stream (new key) so each run starts from a clean slate.
    setSession(null);
    void run({ brandId, prompt, tier, aspectRatio, variantCount, platform });
  }

  const canGenerate = Boolean(platform) && prompt.trim().length > 0 && !pending;
  // Which presets this platform prefers (advisory highlight) — TikTok/YouTube
  // (video-only) return none, so we fall back to showing all four unmarked.
  const recommended = platform ? imagePresetsForPlatform(platform) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <ImagePlus className="size-3.5" />
          Generate an image
        </CardTitle>
        {hasVoiceProfile && (
          <span className="text-xs text-muted-foreground">
            Brand style applied
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!platform ? (
          <p className="text-sm text-muted-foreground">
            Select a platform above to generate an image for it.
          </p>
        ) : (
          <>
            <Textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-label="Prompt for AI image generation"
              placeholder={`Describe the image, e.g. "A flat-lay of an iced cold brew on a sunlit café table, warm tones."`}
            />
            {seedCaption.trim().length > 0 && prompt.trim().length === 0 && (
              <button
                type="button"
                onClick={() => setPrompt(seedCaption.trim())}
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Use the caption as a starting point
              </button>
            )}

            {/* Model tier */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Quality:</span>
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  aria-pressed={tier === t.id}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 transition-colors",
                    tier === t.id
                      ? "border-foreground font-medium text-foreground"
                      : "border-border hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Aspect ratio preset */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Aspect:</span>
              {IMAGE_ASPECT_PRESETS.map((preset) => {
                const isRecommended = recommended.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setAspectRatio(preset.id)}
                    aria-pressed={aspectRatio === preset.id}
                    title={
                      isRecommended
                        ? `Recommended for ${PLATFORM_CONFIG[platform].label}`
                        : undefined
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 transition-colors",
                      aspectRatio === preset.id
                        ? "border-foreground font-medium text-foreground"
                        : "border-border hover:text-foreground",
                      isRecommended &&
                        aspectRatio !== preset.id &&
                        "border-foreground/40",
                    )}
                  >
                    {preset.id}
                  </button>
                );
              })}
            </div>

            {/* Variant count + generate */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Variants:</span>
                {VARIANT_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVariantCount(n)}
                    aria-pressed={variantCount === n}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 transition-colors",
                      variantCount === n
                        ? "border-foreground font-medium text-foreground"
                        : "border-border hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={generate}
                disabled={!canGenerate}
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Generating…
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </div>

            {/* Server VALIDATION / INSUFFICIENT_CREDITS surface here. */}
            {(message || fieldErrors) && (
              <div role="alert" className="text-sm text-destructive">
                {message}
                {fieldErrors &&
                  Object.values(fieldErrors)
                    .flat()
                    .map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}

            {session && (
              <ImageStream
                key={session.job.jobId}
                job={session.job}
                count={session.count}
                onUse={(asset) => onAttach(asset, [session.platform])}
              />
            )}

            <p className="text-xs text-muted-foreground">
              Generates {variantCount} {tier} image
              {variantCount === 1 ? "" : "s"} for{" "}
              {PLATFORM_CONFIG[platform].label} from your prompt and brand
              style. Credits are charged per image (premium costs more than
              standard) and only successful images are charged. Edit the prompt
              and generate again to regenerate.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ImageStreamProps = {
  job: Job;
  count: number;
  onUse: (asset: MediaAssetView) => void;
};

/**
 * Subscribes to one image job's realtime channel and renders the variant grid
 * as images arrive (an `asset` per completed variant), falling back to
 * `done.assets` for any dropped message. Keyed by jobId in the parent so each
 * generation gets a fresh subscription + message history.
 */
function ImageStream({ job, count, onUse }: ImageStreamProps) {
  const { messages, connectionStatus } = useJobStream({
    channel: imageChannel(job.jobId),
    topics: ["asset", "done", "error"] as const,
    token: job.token,
  });

  // `data` is typed `unknown`; the shapes are guaranteed by the channel's zod
  // schemas (validated on publish, image-channel.ts). Dedupe by id across the
  // incremental `asset` messages and the `done.assets` fallback.
  const byId = new Map<string, MediaAssetView>();
  for (const m of messages.all) {
    if (m.topic === "asset") {
      const a = m.data as MediaAssetView;
      byId.set(a.id, a);
    } else if (m.topic === "done") {
      for (const a of (m.data as { assets: MediaAssetView[] }).assets)
        byId.set(a.id, a);
    }
  }
  const assets = [...byId.values()];

  const doneMsg = messages.all.find((m) => m.topic === "done");
  const done = doneMsg
    ? (doneMsg.data as { failed: number; assets: MediaAssetView[] })
    : null;
  const errorMsg = messages.all.find((m) => m.topic === "error");
  const errorText = errorMsg
    ? (errorMsg.data as { message: string }).message
    : null;

  if (errorText) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorText}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {assets.map((asset) => (
          <div key={asset.id} className="flex flex-col gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- external R2/CDN URL, client-only (§7 SSRF-safe) */}
            <img
              src={asset.url}
              alt="Generated image variant"
              className="aspect-square w-full rounded-md border object-cover"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onUse(asset)}
            >
              Use this
            </Button>
          </div>
        ))}
        {/* Placeholders for variants still generating. */}
        {!done &&
          Array.from({ length: Math.max(0, count - assets.length) }).map(
            (_unused, i) => (
              <div
                key={`pending-${i}`}
                className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
              </div>
            ),
          )}
      </div>
      {!done ? (
        <p className="text-xs text-muted-foreground">
          {connectionStatus === "open" ? "Generating…" : "Connecting…"}
        </p>
      ) : (
        done.failed > 0 && (
          <p className="text-xs text-muted-foreground">
            {done.failed} image{done.failed === 1 ? "" : "s"} couldn&apos;t be
            generated — those credits were refunded.
          </p>
        )
      )}
    </div>
  );
}
