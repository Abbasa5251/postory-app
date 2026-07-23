"use client";

import { ImageIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MediaFacets } from "@/lib/validation/media";
import { AssetCard } from "./asset-card";
import type { MediaLibraryItem } from "./types";

/**
 * Facet groups → URL params. Each has an "All" sentinel (`all`) that clears the
 * param. Values mirror the media_assets vocabularies; the `moderation` param
 * maps to the moderation_status column server-side.
 */
const FACET_GROUPS = [
  {
    param: "kind",
    allLabel: "All types",
    options: [
      { value: "image", label: "Images" },
      { value: "video", label: "Videos" },
    ],
  },
  {
    param: "source",
    allLabel: "All sources",
    options: [
      { value: "upload", label: "Uploaded" },
      { value: "generated", label: "AI-generated" },
    ],
  },
  {
    param: "moderation",
    allLabel: "All statuses",
    options: [
      { value: "pending", label: "Pending" },
      { value: "passed", label: "Approved" },
      { value: "blocked", label: "Blocked" },
    ],
  },
] as const;

const ALL = "all";

/**
 * The D4 asset-library surface: an inline row of facet dropdowns (matching the
 * mockup) over a responsive grid of asset cards. Filtering is URL-driven — a
 * dropdown pushes a `searchParams` change and the RSC page re-fetches
 * server-side (no client data fetch). Purely reads props threaded from the page.
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

  function setFacet(param: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL) next.delete(param);
    else next.set(param, value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {FACET_GROUPS.map((group) => (
          <Select
            key={group.param}
            value={active[group.param] ?? ALL}
            onValueChange={(value) => setFacet(group.param, value ?? ALL)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{group.allLabel}</SelectItem>
              {group.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push(pathname)}
          >
            Clear
          </Button>
        )}
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
