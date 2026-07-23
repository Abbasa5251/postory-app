import { AssetLibrary } from "@/components/features/media/asset-library";
import { loadMediaFilters } from "@/components/features/media/search-params";
import type { MediaLibraryItem } from "@/components/features/media/types";
import { UploadMediaButton } from "@/components/features/media/upload-media-button";
import { PageHeader } from "@/components/features/shell/page-header";
import { countMediaUsage, listMediaForBrand } from "@/server/dal/media";
import { publicUrl } from "@/server/services/storage";
import { requireBrand } from "../_lib/require-brand";

// Bound the payload (newest first). Keyset pagination is a deferred follow-up;
// a generous cap covers a brand's library at launch scale.
const LIBRARY_PAGE_SIZE = 120;

// Thin route (§5): parse facets, scoped DAL reads, map to serving views, render.
// params/searchParams are Promises in Next 16.
export default async function MediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brandId } = await params;
  // nuqs loader — the single parser source shared with the client filter row.
  // Absent/invalid values parse to null (→ unfiltered), so a hand-edited query
  // degrades cleanly.
  const filters = await loadMediaFilters(searchParams);
  const { ctx, brand } = await requireBrand(brandId);

  const assets = await listMediaForBrand(ctx, brandId, {
    kind: filters.kind ?? undefined,
    source: filters.source ?? undefined,
    moderationStatus: filters.moderation ?? undefined,
    limit: LIBRARY_PAGE_SIZE,
  });
  // One org-scoped aggregate for the whole page — how many posts use each asset.
  const usage = await countMediaUsage(
    ctx,
    assets.map((asset) => asset.id),
  );

  // Map to serving views here (publicUrl is server-only; never expose r2Key).
  const items: MediaLibraryItem[] = assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind as "image" | "video",
    url: publicUrl(asset.r2Key),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    moderationStatus: asset.moderationStatus,
    source: asset.source as "upload" | "generated",
    createdAt: asset.createdAt.toISOString(),
    usageCount: usage.get(asset.id) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Media library"
        description={`Every asset uploaded or generated for ${brand.name}.`}
        actions={<UploadMediaButton brandId={brandId} />}
      />
      <AssetLibrary brandId={brandId} items={items} />
    </div>
  );
}
