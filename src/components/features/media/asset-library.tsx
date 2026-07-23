"use client";

import { ImageIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetCard } from "./asset-card";
import { mediaFilterParsers } from "./search-params";
import type { MediaLibraryItem } from "./types";

/** Facet groups → the nuqs param keys. Values mirror the media_assets
 * vocabularies; the `moderation` key maps to the moderation_status column. */
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

const ALL = "all";

/**
 * The D4 asset-library surface: an inline row of labelled facet dropdowns over
 * a responsive grid of asset cards. Filter state lives in the URL via **nuqs**
 * (`useQueryStates`, `shallow: false`) — changing a dropdown updates the query
 * string and re-renders the server page, which re-runs the scoped DAL read. No
 * client data fetch; the parser map is shared with the page (search-params.ts).
 */
export function AssetLibrary({
  brandId,
  items,
}: {
  brandId: string;
  items: MediaLibraryItem[];
}) {
  const [filters, setFilters] = useQueryStates(mediaFilterParsers, {
    shallow: false,
  });
  const hasFilters = Boolean(
    filters.kind || filters.source || filters.moderation,
  );

  function setFacet(
    param: (typeof FACET_GROUPS)[number]["param"],
    value: string,
  ) {
    // ALL clears the filter; otherwise run the value through the matching
    // parser, which narrows it to the facet's literal (or null for anything
    // unexpected) — no casts, and consistent with how the URL is parsed.
    if (param === "kind")
      void setFilters({
        kind: value === ALL ? null : mediaFilterParsers.kind.parse(value),
      });
    else if (param === "source")
      void setFilters({
        source: value === ALL ? null : mediaFilterParsers.source.parse(value),
      });
    else
      void setFilters({
        moderation:
          value === ALL ? null : mediaFilterParsers.moderation.parse(value),
      });
  }

  function clearAll() {
    void setFilters({ kind: null, source: null, moderation: null });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        {FACET_GROUPS.map((group) => {
          const triggerId = `media-filter-${group.param}`;
          return (
            <div key={group.param} className="flex flex-col gap-1.5">
              <Label
                htmlFor={triggerId}
                className="text-xs font-medium text-muted-foreground"
              >
                {group.label}
              </Label>
              <Select
                value={filters[group.param] ?? ALL}
                onValueChange={(value) => setFacet(group.param, value ?? ALL)}
              >
                <SelectTrigger id={triggerId} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
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
              <Button type="button" variant="outline" onClick={clearAll}>
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
