"use client";

import { useQueryStates } from "nuqs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPlatformConfig, PLATFORM_LIST } from "@/lib/platforms/config";
import { approvalFilterParsers } from "./search-params";

const ALL = "all";

/**
 * The E2 review-queue filter row (mockup: "All workspaces" + "All platforms" in
 * the header, top-right). Filter state lives in the URL via **nuqs**
 * (`useQueryStates`, `shallow: false`) — changing a dropdown updates the query
 * string and re-renders the server page, which re-runs the scoped DAL read. No
 * client data fetch; the parser map is shared with the page (search-params.ts).
 * Mirrors the D4 media `AssetLibrary` filter pattern.
 *
 * Workspace options are the reviewer's approvable brands (passed by the page);
 * platform options come from the single-source `PLATFORM_LIST`.
 */
export function ApprovalsFilters({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [filters, setFilters] = useQueryStates(approvalFilterParsers, {
    shallow: false,
  });
  const hasFilters = Boolean(filters.workspace || filters.platform);

  // Base UI's SelectValue renders the raw value (a brand id / platform id) by
  // default — map it to the human label for the trigger. The dropdown items
  // already show the label; this keeps the collapsed trigger consistent.
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  return (
    <div className="flex items-center gap-2">
      <Select
        value={filters.workspace ?? ALL}
        onValueChange={(value) => {
          const v = value ?? ALL;
          void setFilters({ workspace: v === ALL ? null : v });
        }}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Workspace">
          <SelectValue>
            {(value) =>
              value && value !== ALL
                ? (brandName.get(value) ?? "All workspaces")
                : "All workspaces"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All workspaces</SelectItem>
          {brands.map((brand) => (
            <SelectItem key={brand.id} value={brand.id}>
              {brand.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.platform ?? ALL}
        onValueChange={(value) => {
          const v = value ?? ALL;
          void setFilters({
            platform:
              v === ALL ? null : approvalFilterParsers.platform.parse(v),
          });
        }}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Platform">
          <SelectValue>
            {(value) =>
              value && value !== ALL
                ? (getPlatformConfig(value)?.label ?? "All platforms")
                : "All platforms"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All platforms</SelectItem>
          {PLATFORM_LIST.map((platform) => (
            <SelectItem key={platform.id} value={platform.id}>
              {platform.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void setFilters({ workspace: null, platform: null })}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
