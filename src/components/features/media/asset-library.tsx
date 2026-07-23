"use client";

import { ImageIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MediaFacets } from "@/lib/validation/media";
import { AssetCard } from "./asset-card";
import type { MediaLibraryItem } from "./types";

/** Facet groups → URL params. Values mirror the media_assets vocabularies; the
 * `moderation` param maps to the moderation_status column server-side. */
const FACET_GROUPS = [
  {
    param: "kind",
    label: "Type",
    options: [
      { value: "image", label: "Images" },
      { value: "video", label: "Videos" },
    ],
  },
  {
    param: "source",
    label: "Source",
    options: [
      { value: "upload", label: "Uploaded" },
      { value: "generated", label: "AI-generated" },
    ],
  },
  {
    param: "moderation",
    label: "Status",
    options: [
      { value: "pending", label: "Pending" },
      { value: "passed", label: "Approved" },
      { value: "blocked", label: "Blocked" },
    ],
  },
] as const;

/**
 * The D4 asset-library surface: facet filter chips + a responsive grid of
 * asset cards. Filtering is URL-driven — a chip pushes a `searchParams` change
 * and the RSC page re-fetches server-side (no client data fetch, matching the
 * app's server-first data flow). Purely reads props threaded from the page.
 */
export function AssetLibrary({
  brandId,
  items,
  facets,
}: {
  brandId: string;
  items: MediaLibraryItem[];
  facets: MediaFacets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active: Record<string, string | undefined> = {
    kind: facets.kind,
    source: facets.source,
    moderation: facets.moderation,
  };
  const hasFilters = Object.values(active).some(Boolean);

  function setFacet(param: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(param);
    else next.set(param, value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {FACET_GROUPS.map((group) => {
          const current = active[group.param];
          return (
            <div
              key={group.param}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                {group.label}
              </span>
              <Button
                type="button"
                size="sm"
                variant={current ? "outline" : "secondary"}
                onClick={() => setFacet(group.param, null)}
              >
                All
              </Button>
              {group.options.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={current === option.value ? "secondary" : "outline"}
                  onClick={() => setFacet(group.param, option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="size-5" />}
          title={hasFilters ? "No matching media" : "No media yet"}
          description={
            hasFilters
              ? "No assets match these filters. Clear them to see everything."
              : "Upload media or generate images from the composer — they’ll appear here."
          }
          action={
            hasFilters ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(pathname)}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <AssetCard key={item.id} brandId={brandId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
