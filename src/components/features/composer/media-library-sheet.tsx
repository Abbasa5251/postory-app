"use client";

import { ImageIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { MediaAssetView } from "./media-types";

type MediaLibrarySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This brand's assets (C4 picker — reuse already-uploaded media). */
  library: MediaAssetView[];
  /** Ids already attached to the active platform (rendered as selected). */
  attachedIds: string[];
  onPick: (asset: MediaAssetView) => void;
};

/**
 * Composer asset-library picker (C4). A slide-over grid of the brand's uploaded
 * media; picking one attaches it to the active platform. The full library
 * management page (search/filter, delete, usage, orphan cleanup) is D4 — this
 * is intentionally just the reuse-in-composer picker.
 */
export function MediaLibrarySheet({
  open,
  onOpenChange,
  library,
  attachedIds,
  onPick,
}: MediaLibrarySheetProps) {
  const attached = new Set(attachedIds);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Media library</SheetTitle>
          <SheetDescription>
            Reuse media you&apos;ve already uploaded for this brand.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {library.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ImageIcon className="size-6" />
              <p>
                No media yet. Upload a file to build this brand&apos;s library.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {library.map((asset) => {
                const isAttached = attached.has(asset.id);
                const dims =
                  asset.width && asset.height
                    ? ` ${asset.width}×${asset.height}`
                    : "";
                const label = `${isAttached ? "Attached" : "Attach"} ${asset.kind}${dims}`;
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => onPick(asset)}
                      aria-pressed={isAttached}
                      aria-label={label}
                      className={cn(
                        "group relative block aspect-square w-full overflow-hidden rounded-md border bg-muted transition-colors",
                        isAttached
                          ? "border-primary ring-2 ring-primary"
                          : "border-border hover:border-foreground/40",
                      )}
                      title={label}
                    >
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
                      {asset.kind === "video" && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                          Video
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
