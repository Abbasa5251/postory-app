import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { PLATFORMS } from "@/lib/platforms/config";

/**
 * Approvals review-queue URL search params (E2), owned with **nuqs** — the
 * single source of truth for the filter query string, shared by the server page
 * (`loadApprovalFilters`) and the client filter row (`useQueryStates`), §4.
 * Mirrors the D4 media `search-params.ts` pattern.
 *
 * `workspace` is a brand id, parsed as a plain string: the valid vocabulary is
 * per-org (the caller's assigned brands), so it can't be a compile-time literal
 * set — the page validates it against the reviewer's approvable brands and drops
 * anything else (a hand-edited/stale id degrades to "all workspaces"). `platform`
 * uses the `PLATFORMS` tuple, so an invalid value parses to null → unfiltered.
 */
export const approvalFilterParsers = {
  workspace: parseAsString,
  platform: parseAsStringLiteral(PLATFORMS),
};

/** Server-side loader — Next 16's `searchParams` is a Promise the loader awaits. */
export const loadApprovalFilters = createLoader(approvalFilterParsers);
