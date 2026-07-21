"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/features/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { PLATFORM_CONFIG, type Platform } from "@/lib/platforms/config";
import type { PostContent } from "@/lib/validation/posts";
import { cn } from "@/lib/utils";
import { saveDraft } from "@/server/actions/posts";
import { AdaptCard } from "./adapt-card";
import { AiCopyCard } from "./ai-copy-card";
import { DisabledCard } from "./disabled-card";
import { MediaCard } from "./media-card";
import type { MediaAssetView } from "./media-types";

export type ComposerPlatform = {
  id: Platform;
  label: string;
  color: string;
  /** Whether the brand has a connected account for this platform. */
  connected: boolean;
};

type ComposerProps = {
  brandId: string;
  brandName: string;
  timezone: string;
  platforms: ComposerPlatform[];
  /** Present when editing an existing draft. */
  initial?: { postId: string; content: PostContent };
  /** Whether the brand has a voice profile the AI will apply (C2). */
  hasVoiceProfile: boolean;
  /** This brand's uploaded media, for the C4 library picker + thumbnails. */
  libraryAssets: MediaAssetView[];
};

function captionsFromContent(content: PostContent | undefined) {
  const map: Partial<Record<Platform, string>> = {};
  for (const [platform, variant] of Object.entries(content?.variants ?? {})) {
    map[platform as Platform] = variant.caption;
  }
  return map;
}

function mediaFromContent(content: PostContent | undefined) {
  const map: Partial<Record<Platform, string[]>> = {};
  for (const [platform, variant] of Object.entries(content?.variants ?? {})) {
    if (variant.mediaIds?.length)
      map[platform as Platform] = [...variant.mediaIds];
  }
  return map;
}

export function Composer({
  brandId,
  brandName,
  timezone,
  platforms,
  initial,
  hasVoiceProfile,
  libraryAssets,
}: ComposerProps) {
  const [targets, setTargets] = useState<Platform[]>(
    initial?.content.targets ?? [],
  );
  const [captions, setCaptions] = useState<Partial<Record<Platform, string>>>(
    () => captionsFromContent(initial?.content),
  );
  // Per-platform attached media asset ids (C4) + the known asset details for
  // rendering thumbnails / the picker (initial library grows as we upload/pick).
  const [media, setMedia] = useState<Partial<Record<Platform, string[]>>>(() =>
    mediaFromContent(initial?.content),
  );
  const [library, setLibrary] = useState<MediaAssetView[]>(libraryAssets);
  // The user's explicit tab selection; the *effective* active tab is derived
  // below so it stays valid as targets change (no effect, no cascading render).
  const [selectedTab, setSelectedTab] = useState<Platform | undefined>(
    initial?.content.targets[0],
  );
  const [postId, setPostId] = useState<string | undefined>(initial?.postId);

  const { pending, message, fieldErrors, run } = useActionForm(saveDraft, {
    onSuccess: (data: { id: string }) => {
      toast.success("Draft saved.");
      if (!postId) {
        setPostId(data.id);
        // Reflect the new id in the URL so a refresh keeps editing this draft,
        // without a server round-trip that would reset the in-progress form.
        window.history.replaceState(null, "", `?post=${data.id}`);
      }
    },
  });

  // Effective active tab, derived so it stays valid as targets change: the
  // user's selection if still targeted, else the first target (undefined when
  // nothing is selected).
  const active =
    selectedTab && targets.includes(selectedTab) ? selectedTab : targets[0];

  function toggleTarget(platform: Platform) {
    setTargets((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
    setCaptions((prev) =>
      prev[platform] === undefined ? { ...prev, [platform]: "" } : prev,
    );
  }

  function setCaption(platform: Platform, value: string) {
    setCaptions((prev) => ({ ...prev, [platform]: value }));
  }

  /** Attach an asset to the given platforms (C4), ensuring each is targeted. */
  function attachMedia(asset: MediaAssetView, platformsToAttach: Platform[]) {
    setLibrary((prev) =>
      prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev],
    );
    for (const platform of platformsToAttach) {
      if (!targets.includes(platform)) toggleTarget(platform);
    }
    setMedia((prev) => {
      const next = { ...prev };
      for (const platform of platformsToAttach) {
        const current = next[platform] ?? [];
        if (!current.includes(asset.id))
          next[platform] = [...current, asset.id];
      }
      return next;
    });
  }

  function removeMedia(platform: Platform, assetId: string) {
    setMedia((prev) => ({
      ...prev,
      [platform]: (prev[platform] ?? []).filter((id) => id !== assetId),
    }));
  }

  const activeLimit = active ? PLATFORM_CONFIG[active].charLimit : 0;
  const activeLength = active ? (captions[active] ?? "").length : 0;
  const activeOver = activeLength > activeLimit;
  const activeNear = activeLength > activeLimit * 0.9;

  // Client-side guard (UX only — postContentSchema is the real enforcement):
  // block save with no target or any over-limit caption.
  const overSomePlatform = targets.some(
    (p) => (captions[p] ?? "").length > PLATFORM_CONFIG[p].charLimit,
  );
  const canSave = targets.length > 0 && !overSomePlatform && !pending;

  function save() {
    const content: PostContent = {
      targets,
      variants: Object.fromEntries(
        targets.map((p) => {
          const mediaIds = media[p] ?? [];
          return [
            p,
            {
              caption: captions[p] ?? "",
              ...(mediaIds.length > 0 ? { mediaIds } : {}),
            },
          ];
        }),
      ),
    };
    void run({ brandId, postId, content });
  }

  const activePlatformLabel = active ? PLATFORM_CONFIG[active].label : null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={postId ? "Edit draft" : "New post"}
        description={`Drafting for ${brandName}.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled
              title="Submitting for approval lands with Epic E."
            >
              Submit for approval
            </Button>
            <Button type="button" onClick={save} disabled={!canSave}>
              {pending ? "Saving…" : "Save draft"}
            </Button>
          </>
        }
      />

      {(message || fieldErrors) && (
        <div role="alert" className="mb-4 space-y-1 text-sm text-destructive">
          {message && <p>{message}</p>}
          {/* Server-side VALIDATION failures set fieldErrors, not message —
              surface them so feedback shows even when the client guard didn't. */}
          {fieldErrors &&
            Object.values(fieldErrors)
              .flat()
              .map((err, i) => <p key={i}>{err}</p>)}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-[min(100%,26rem)] flex-10 flex-col gap-4">
          {/* Publish to — target platforms */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Publish to
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {platforms.map((platform) => {
                const selected = targets.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    disabled={!platform.connected}
                    onClick={() => toggleTarget(platform.id)}
                    aria-pressed={selected}
                    title={
                      platform.connected
                        ? undefined
                        : "Connect this platform first (Connections)."
                    }
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      selected
                        ? "border-[1.5px] font-medium"
                        : "border-border text-muted-foreground hover:text-foreground",
                      !platform.connected &&
                        "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                    )}
                    style={
                      selected ? { borderColor: platform.color } : undefined
                    }
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: platform.color,
                        opacity: selected ? 1 : 0.35,
                      }}
                    />
                    {platform.label}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Write once — adapt one caption to every target platform (C3) */}
          <AdaptCard
            brandId={brandId}
            targets={targets}
            hasVoiceProfile={hasVoiceProfile}
            onAdapted={(platform, caption) => {
              // Ensure the platform is targeted (so its tab + variant exist),
              // then write the adapted caption into it. Don't switch the active
              // tab — captions arrive one platform at a time and jumping tabs
              // on each would be disorienting.
              if (!targets.includes(platform)) toggleTarget(platform);
              setCaption(platform, caption);
            }}
          />

          {/* Caption — per-platform variants + char counter */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Caption
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {targets.length === 0 || !active ? (
                <p className="text-sm text-muted-foreground">
                  Select a platform above to start writing.
                </p>
              ) : (
                <>
                  <Tabs
                    value={active}
                    onValueChange={(value) => setSelectedTab(value as Platform)}
                  >
                    <TabsList variant="line">
                      {targets.map((platform) => (
                        <TabsTrigger key={platform} value={platform}>
                          <span
                            className="size-2 rounded-full"
                            style={{
                              backgroundColor: PLATFORM_CONFIG[platform].color,
                            }}
                          />
                          {PLATFORM_CONFIG[platform].label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Textarea
                    rows={6}
                    value={captions[active] ?? ""}
                    onChange={(e) => setCaption(active, e.target.value)}
                    aria-invalid={activeOver}
                    aria-label={`Caption for ${activePlatformLabel}`}
                    placeholder={`Write the ${activePlatformLabel} caption…`}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {`Variant for ${activePlatformLabel} — edits here don't change other platforms.`}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        activeOver
                          ? "font-medium text-destructive"
                          : activeNear
                            ? "text-destructive/80"
                            : "text-muted-foreground",
                      )}
                    >
                      {activeLength.toLocaleString()} /{" "}
                      {activeLimit.toLocaleString()}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <AiCopyCard
            brandId={brandId}
            platform={active}
            hasVoiceProfile={hasVoiceProfile}
            onApply={(platform, caption) => {
              // Ensure the platform is targeted (so its tab + variant exist),
              // then write the generated caption into it.
              if (!targets.includes(platform)) toggleTarget(platform);
              setCaption(platform, caption);
              setSelectedTab(platform);
            }}
          />
          <MediaCard
            brandId={brandId}
            targets={targets}
            active={active}
            media={media}
            library={library}
            onAttach={attachMedia}
            onRemove={removeMedia}
          />
          <DisabledCard title="Schedule" soon="F1">
            {`Pick a date and time to publish — ${timezone} (workspace timezone). Scheduling lands with F1.`}
          </DisabledCard>
        </div>

        <div className="min-w-[min(100%,18rem)] flex-1">
          <DisabledCard title="Preview" soon="C5">
            Feed-accurate preview cards for every platform land with C5.
          </DisabledCard>
        </div>
      </div>
    </div>
  );
}
