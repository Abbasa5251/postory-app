"use client";

import { AlertTriangle, ImagePlus, Library, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  assetFitsPlatform,
  mediaKindForMime,
  PLATFORM_CONFIG,
  type Platform,
} from "@/lib/platforms/config";
import { createUploadUrl, recordUpload } from "@/server/actions/media";
import { MediaLibrarySheet } from "./media-library-sheet";
import type { MediaAssetView } from "./media-types";

type MediaCardProps = {
  brandId: string;
  /** Current target platforms (media attaches per platform, D-C4-1). */
  targets: Platform[];
  /** The active caption/media tab — where a single-platform attach lands. */
  active: Platform | undefined;
  /** Attached asset ids per platform (mirrors the composer's `media` state). */
  media: Partial<Record<Platform, string[]>>;
  /** This brand's known assets (initial library + anything uploaded/picked). */
  library: MediaAssetView[];
  /** Attach an asset to the given platforms (adds it to the library too). */
  onAttach: (asset: MediaAssetView, platforms: Platform[]) => void;
  /** Detach an asset from one platform. */
  onRemove: (platform: Platform, assetId: string) => void;
};

/** A single in-flight upload (transient — cleared on completion/failure). */
type Upload = { id: string; name: string; progress: number };

/** Client-probe an image/video for its natural dimensions (+ video duration). */
async function probeDimensions(
  file: File,
  kind: "image" | "video",
): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("probe failed"));
        img.src = url;
      });
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("probe failed"));
      video.src = url;
    });
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Math.round(video.duration),
    };
  } catch {
    // Probe is advisory — a failure just means no dims (server still gates
    // mime/size; publish gates aspect/duration). Don't block the upload.
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PUT the file straight to R2/MinIO via the presigned URL, reporting progress. */
function putToStore(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

export function MediaCard({
  brandId,
  targets,
  active,
  media,
  library,
  onAttach,
  onRemove,
}: MediaCardProps) {
  const [applyToAll, setApplyToAll] = useState(true);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const byId = new Map(library.map((a) => [a.id, a]));
  const activeIds = active ? (media[active] ?? []) : [];
  const activeAssets = activeIds
    .map((id) => byId.get(id))
    .filter((a): a is MediaAssetView => a !== undefined);

  /** Platforms a new attach should land on: all targets, or just the active. */
  function attachTargets(): Platform[] {
    return applyToAll ? targets : active ? [active] : [];
  }

  async function handleFiles(files: File[]) {
    const platforms = attachTargets();
    for (const file of files) {
      const kind = mediaKindForMime(file.type);
      if (kind !== "image" && kind !== "video") {
        setErrors((prev) => [...prev, `${file.name}: unsupported file type.`]);
        continue;
      }
      const uploadId = globalThis.crypto.randomUUID();
      setUploads((prev) => [
        ...prev,
        { id: uploadId, name: file.name, progress: 0 },
      ]);
      try {
        const dims = await probeDimensions(file, kind);
        const created = await createUploadUrl({
          brandId,
          kind,
          mimeType: file.type,
          sizeBytes: file.size,
          ...dims,
        });
        if (!created.ok) {
          throw new Error(created.error.message || "Could not start upload.");
        }
        await putToStore(created.data.url, file, (pct) =>
          setUploads((prev) =>
            prev.map((u) => (u.id === uploadId ? { ...u, progress: pct } : u)),
          ),
        );
        const recorded = await recordUpload({
          brandId,
          r2Key: created.data.r2Key,
          kind,
          width: dims.width,
          height: dims.height,
          durationSeconds: dims.durationSeconds,
        });
        if (!recorded.ok) {
          throw new Error(recorded.error.message || "Could not save upload.");
        }
        // The action returns `kind` as a string column; narrow to the view's
        // union (it can only ever be the kind we uploaded).
        onAttach(recorded.data as MediaAssetView, platforms);
      } catch (error) {
        setErrors((prev) => [
          ...prev,
          `${file.name}: ${error instanceof Error ? error.message : "upload failed."}`,
        ]);
      } finally {
        setUploads((prev) => prev.filter((u) => u.id !== uploadId));
      }
    }
  }

  const disabled = targets.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <ImagePlus className="size-3.5" />
          Media
        </CardTitle>
        {targets.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={applyToAll}
              onCheckedChange={setApplyToAll}
            />
            Apply to all platforms
          </label>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {disabled ? (
          <p className="text-sm text-muted-foreground">
            Select a platform above to add media.
          </p>
        ) : (
          <>
            {/* Dropzone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFiles(Array.from(e.dataTransfer.files));
              }}
              className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center"
            >
              <ImagePlus className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag &amp; drop, or
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                >
                  Upload
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLibraryOpen(true)}
                >
                  <Library className="size-4" /> Choose from library
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files)
                    void handleFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>

            {/* In-flight uploads */}
            {uploads.map((u) => (
              <div key={u.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto tabular-nums">{u.progress}%</span>
                </div>
                <Progress value={u.progress} />
              </div>
            ))}

            {/* Attached media for the active platform */}
            {active && activeAssets.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {activeAssets.map((asset) => {
                  const fit = assetFitsPlatform(active, {
                    kind: asset.kind,
                    mimeType: asset.mimeType,
                    sizeBytes: asset.sizeBytes,
                    width: asset.width,
                    height: asset.height,
                    durationSeconds: asset.durationSeconds,
                  });
                  return (
                    <li key={asset.id} className="flex flex-col gap-1">
                      <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        {asset.kind === "video" ? (
                          <video
                            src={asset.url}
                            className="size-full object-cover"
                            muted
                            preload="metadata"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.url}
                            alt=""
                            className="size-full object-cover"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(active, asset.id)}
                          aria-label="Remove media"
                          className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      {!fit.ok && (
                        <p
                          className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-500"
                          title={fit.warnings.join(" ")}
                        >
                          <AlertTriangle className="mt-px size-3 shrink-0" />
                          <span className="line-clamp-2">
                            {fit.warnings[0]}
                          </span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {active && (
              <p className="text-xs text-muted-foreground">
                {`Media for ${PLATFORM_CONFIG[active].label}. Aspect-ratio and duration checks are guidance; they're enforced when the post is published.`}
              </p>
            )}

            {errors.length > 0 && (
              <div role="alert" className="space-y-1 text-sm text-destructive">
                {errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      <MediaLibrarySheet
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        library={library}
        attachedIds={activeIds}
        onPick={(asset) => {
          onAttach(asset, attachTargets());
          setLibraryOpen(false);
        }}
      />
    </Card>
  );
}
