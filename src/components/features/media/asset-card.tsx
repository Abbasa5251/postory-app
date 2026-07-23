import { Badge } from "@/components/ui/badge";
import { DeleteAssetButton } from "./delete-asset-button";
import type { MediaLibraryItem } from "./types";

/** Human-readable file size, or null when unknown. */
function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One asset tile in the D4 library grid: a square thumbnail (image or video,
 * the shared C4/C5 convention), source/status badges, a size/dimensions line,
 * a usage count, and the delete control. Purely presentational.
 */
export function AssetCard({
  brandId,
  item,
}: {
  brandId: string;
  item: MediaLibraryItem;
}) {
  const dims =
    item.width && item.height ? `${item.width}×${item.height}` : null;
  const size = formatBytes(item.sizeBytes);
  const meta = [dims, size].filter(Boolean).join(" · ");

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {item.kind === "video" ? (
          <video
            src={item.url}
            poster={item.posterUrl ?? undefined}
            className="size-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={
              item.source === "generated"
                ? "AI-generated image"
                : "Uploaded image"
            }
            className="size-full object-cover"
          />
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant="secondary">
            {item.source === "generated" ? "AI" : "Upload"}
          </Badge>
          {item.kind === "video" && <Badge variant="secondary">Video</Badge>}
        </div>
        {item.moderationStatus === "blocked" && (
          <Badge variant="destructive" className="absolute top-2 right-2">
            Blocked
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="truncate">{meta || "—"}</p>
          <p className="truncate">
            {item.usageCount > 0
              ? `Used in ${item.usageCount} post${item.usageCount === 1 ? "" : "s"}`
              : "Not used"}
          </p>
        </div>
        <DeleteAssetButton
          brandId={brandId}
          mediaId={item.id}
          usageCount={item.usageCount}
        />
      </div>
    </div>
  );
}
