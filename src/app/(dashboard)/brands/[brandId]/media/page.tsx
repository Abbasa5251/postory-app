import { AssetLibrary } from "@/components/features/media/asset-library";
import type { MediaLibraryItem } from "@/components/features/media/types";
import { PageHeader } from "@/components/features/shell/page-header";
import { mediaFacetSchema } from "@/lib/validation/media";
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
  // Facets degrade to "unfiltered" on a bad value (each field .catches).
  const facets = mediaFacetSchema.parse(await searchParams);
  const { ctx, brand } = await requireBrand(brandId);

  const assets = await listMediaForBrand(ctx, brandId, {
    kind: facets.kind,
    source: facets.source,
    moderationStatus: facets.moderation,
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
        description={`Uploaded and AI-generated media for ${brand.name}.`}
      />
      <AssetLibrary brandId={brandId} items={items} facets={facets} />
    </div>
  );
}
