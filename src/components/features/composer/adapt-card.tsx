"use client";

import { Check, Loader2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { useJobStream } from "@/hooks/use-job-stream";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";
import { adaptChannel } from "@/lib/realtime/adapt-channel";
import { adaptCopy } from "@/server/actions/copy";

/** The adaptCopy action's success payload (jobId + realtime token). */
type Job = Extract<Awaited<ReturnType<typeof adaptCopy>>, { ok: true }>["data"];

type AdaptCardProps = {
  brandId: string;
  /** The composer's current target platforms — the caption is adapted to each. */
  targets: Platform[];
  hasVoiceProfile: boolean;
  /** Write an adapted caption into the composer for `platform`. */
  onAdapted: (platform: Platform, caption: string) => void;
};

export function AdaptCard({
  brandId,
  targets,
  hasVoiceProfile,
  onAdapted,
}: AdaptCardProps) {
  const [source, setSource] = useState("");
  // The job plus the platforms it was adapting FOR, so the progress list stays
  // stable even if the target chips change mid-run.
  const [session, setSession] = useState<{
    job: Job;
    platforms: Platform[];
  } | null>(null);
  // Bridges the run-time target set to the async onSuccess.
  const runPlatforms = useRef<Platform[]>([]);

  const { pending, message, fieldErrors, run } = useActionForm(adaptCopy, {
    onSuccess: (data: Job) => {
      setSession({ job: data, platforms: runPlatforms.current });
    },
  });

  function adapt() {
    if (targets.length === 0 || source.trim().length === 0) return;
    runPlatforms.current = targets;
    // Remount the stream (new key) so each run starts from a clean slate.
    setSession(null);
    void run({ brandId, platforms: targets, sourceCaption: source });
  }

  const canAdapt = targets.length > 0 && source.trim().length > 0 && !pending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <Wand2 className="size-3.5" />
          Write once
        </CardTitle>
        {hasVoiceProfile && (
          <span className="text-xs text-muted-foreground">
            Brand voice applied
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          rows={4}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Master caption to adapt across platforms"
          placeholder="Write your caption once, then adapt it to a native version for every platform you're publishing to."
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {targets.length === 0
              ? "Select a platform above to adapt for."
              : `Adapts to ${targets.length} platform${targets.length === 1 ? "" : "s"} — 1 credit each (${targets.length} credit${targets.length === 1 ? "" : "s"}).`}
          </p>
          <Button type="button" size="sm" onClick={adapt} disabled={!canAdapt}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Adapting…
              </>
            ) : (
              "Adapt to all platforms"
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
          <AdaptStream
            key={session.job.jobId}
            job={session.job}
            platforms={session.platforms}
            onAdapted={onAdapted}
          />
        )}
      </CardContent>
    </Card>
  );
}

type AdaptStreamProps = {
  job: Job;
  platforms: Platform[];
  onAdapted: (platform: Platform, caption: string) => void;
};

/**
 * Subscribes to one adaptation job's realtime channel and applies each
 * platform's adapted caption to the composer as it arrives, rendering a
 * per-platform progress list. Keyed by jobId in the parent so each run gets a
 * fresh subscription + message history.
 */
function AdaptStream({ job, platforms, onAdapted }: AdaptStreamProps) {
  const { messages, connectionStatus } = useJobStream({
    channel: adaptChannel(job.jobId),
    topics: ["adapted", "done", "error"] as const,
    token: job.token,
  });

  // The hook types message `data` as `unknown`, so we assert per topic. The
  // shapes are guaranteed by the channel's zod schemas, validated on publish
  // (adapt-channel.ts) — re-parsing here would just duplicate that.
  const adapted = messages.all
    .filter((m) => m.topic === "adapted")
    .map((m) => m.data as { platform: Platform; caption: string });
  const doneMsg = messages.all.find((m) => m.topic === "done");
  const doneData = doneMsg
    ? (doneMsg.data as {
        failed: Platform[];
        captions: { platform: Platform; caption: string }[];
      })
    : null;
  const failed = doneData ? doneData.failed : null;
  const errorMsg = messages.all.find((m) => m.topic === "error");
  const errorText = errorMsg
    ? (errorMsg.data as { message: string }).message
    : null;

  // Apply each caption to the composer exactly once (each platform adapts once
  // per job). Guarded by a ref so re-renders never re-apply. Source both the
  // incremental `adapted` messages and `done.captions` — the latter is the
  // fallback for any `adapted` message lost while the connection was down.
  const appliedRef = useRef<Set<Platform>>(new Set());
  useEffect(() => {
    const incoming = doneData ? [...adapted, ...doneData.captions] : adapted;
    for (const a of incoming) {
      if (!appliedRef.current.has(a.platform)) {
        appliedRef.current.add(a.platform);
        onAdapted(a.platform, a.caption);
      }
    }
  }, [messages.all, adapted, doneData, onAdapted]);

  if (errorText) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorText}
      </p>
    );
  }

  const arrived = new Set([
    ...adapted.map((a) => a.platform),
    ...(doneData?.captions.map((c) => c.platform) ?? []),
  ]);
  const failedSet = new Set(failed ?? []);

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {failed === null ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {connectionStatus === "open" ? "Adapting…" : "Connecting…"}
          </>
        ) : failedSet.size === 0 ? (
          "Adapted for every platform."
        ) : (
          `Couldn't adapt for ${failed.length} platform${failed.length === 1 ? "" : "s"}.`
        )}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {platforms.map((platform) => {
          const done = arrived.has(platform);
          const didFail = failedSet.has(platform);
          return (
            <li key={platform} className="flex items-center gap-2">
              {done ? (
                <Check className="size-3.5 text-status-published-foreground" />
              ) : didFail ? (
                <X className="size-3.5 text-destructive" />
              ) : (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
              <span
                className={
                  didFail
                    ? "text-destructive"
                    : done
                      ? ""
                      : "text-muted-foreground"
                }
              >
                {PLATFORM_CONFIG[platform].label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
