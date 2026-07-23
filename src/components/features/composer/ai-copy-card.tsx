"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { useJobStream } from "@/hooks/use-job-stream";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";
import { copyChannel } from "@/lib/realtime/copy-channel";
import { cn } from "@/lib/utils";
import { generateCopy } from "@/server/actions/copy";

/** The generateCopy action's success payload (jobId + realtime token). */
type Job = Extract<
  Awaited<ReturnType<typeof generateCopy>>,
  { ok: true }
>["data"];

const VARIANT_COUNTS = [1, 3, 5] as const;

type AiCopyCardProps = {
  brandId: string;
  /** The composer's active platform tab; AI generates for this one (C3 adapts). */
  platform: Platform | undefined;
  hasVoiceProfile: boolean;
  /** Write a generated caption into the composer for `platform`. */
  onApply: (platform: Platform, caption: string) => void;
};

export function AiCopyCard({
  brandId,
  platform,
  hasVoiceProfile,
  onApply,
}: AiCopyCardProps) {
  const [brief, setBrief] = useState("");
  const [variantCount, setVariantCount] = useState<number>(3);
  // The job plus the platform it was generated FOR, so applying/refining a
  // variant targets that platform even if the active tab changed since.
  const [session, setSession] = useState<{
    job: Job;
    platform: Platform;
  } | null>(null);
  // Bridges the generation-time platform to the async onSuccess.
  const genPlatform = useRef<Platform | null>(null);

  const { pending, message, fieldErrors, run } = useActionForm(generateCopy, {
    onSuccess: (data: Job) => {
      const platform = genPlatform.current;
      if (platform) setSession({ job: data, platform });
    },
  });

  function generate(opts?: {
    platform?: Platform;
    refineFrom?: string;
    instruction?: string;
  }) {
    // Default to the active tab for a fresh generation; a refine passes the
    // generation-time platform explicitly.
    const target = opts?.platform ?? platform;
    if (!target) return;
    genPlatform.current = target;
    // Remount the stream (new key) so each run starts from a clean slate.
    setSession(null);
    void run({
      brandId,
      platform: target,
      brief,
      variantCount,
      refineFrom: opts?.refineFrom,
      instruction: opts?.instruction,
    });
  }

  const canGenerate = Boolean(platform) && brief.trim().length > 0 && !pending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <Sparkles className="size-3.5" />
          Write it with AI
        </CardTitle>
        {hasVoiceProfile && (
          <span className="text-xs text-muted-foreground">
            Brand voice applied
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!platform ? (
          <p className="text-sm text-muted-foreground">
            Select a platform above to generate a caption for it.
          </p>
        ) : (
          <>
            <Textarea
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              aria-label="Brief for AI copy generation"
              placeholder={`What should this ${PLATFORM_CONFIG[platform].label} post say? e.g. "Announce our new cold brew, launching Friday."`}
            />

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
                onClick={() => generate()}
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
              <CopyStream
                key={session.job.jobId}
                job={session.job}
                onApply={(caption) => onApply(session.platform, caption)}
                onRefine={(caption, instruction) =>
                  generate({
                    platform: session.platform,
                    refineFrom: caption,
                    instruction,
                  })
                }
              />
            )}

            <p className="text-xs text-muted-foreground">
              Generates {PLATFORM_CONFIG[platform].label} captions from your
              brief and brand voice. Uses 1 credit per batch. A suggested first
              comment lands with C5.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type CopyStreamProps = {
  job: Job;
  onApply: (caption: string) => void;
  onRefine: (caption: string, instruction: string) => void;
};

/**
 * Subscribes to one generation job's realtime channel and renders the live
 * token stream, then the parsed variant cards. Keyed by jobId in the parent so
 * each generation gets a fresh subscription + message history.
 */
function CopyStream({ job, onApply, onRefine }: CopyStreamProps) {
  const [refiningIndex, setRefiningIndex] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");

  const { messages, connectionStatus } = useJobStream({
    channel: copyChannel(job.jobId),
    topics: ["chunk", "done", "error"] as const,
    token: job.token,
  });

  // The hook types message `data` as `unknown`, so we assert per topic. The
  // shapes are guaranteed by the channel's zod schemas, validated on the
  // publish side (copy-channel.ts) — re-parsing here would just duplicate that.
  const streamed = messages.all
    .filter((m) => m.topic === "chunk")
    .map((m) => (m.data as { text: string }).text)
    .join("");
  const doneMsg = messages.all.find((m) => m.topic === "done");
  const done = doneMsg
    ? (doneMsg.data as { variants: string[]; blocked: number })
    : null;
  // Only the variants that PASSED D5 moderation; `blocked` is how many were
  // withheld (still charged — the batch was generated).
  const variants = done ? done.variants : null;
  const blockedCount = done ? done.blocked : 0;
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

  // Streaming: show the accumulating text until the final variants arrive.
  if (!variants) {
    return (
      <div className="rounded-md border border-dashed p-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {connectionStatus === "open" ? "Writing…" : "Connecting…"}
        </div>
        <p className="text-sm whitespace-pre-wrap">{streamed}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {blockedCount > 0 && (
        <p role="alert" className="text-xs text-muted-foreground">
          {blockedCount} caption{blockedCount === 1 ? " was" : "s were"} blocked
          by content moderation and hidden.
          {variants.length === 0 ? " Try rephrasing your brief." : ""}
        </p>
      )}
      {variants.map((variant, i) => (
        <div key={i} className="rounded-md border p-3">
          <p className="text-sm whitespace-pre-wrap">{variant}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onApply(variant)}
            >
              Use this
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRefiningIndex(refiningIndex === i ? null : i)}
            >
              Refine
            </Button>
          </div>
          {refiningIndex === i && (
            <div className="mt-2 flex flex-col gap-2">
              <Textarea
                rows={2}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                aria-label="How should the AI change this caption?"
                placeholder='e.g. "Make it punchier and add a question."'
              />
              <Button
                type="button"
                size="sm"
                disabled={instruction.trim().length === 0}
                onClick={() => {
                  onRefine(variant, instruction);
                  setInstruction("");
                  setRefiningIndex(null);
                }}
              >
                Refine this
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
