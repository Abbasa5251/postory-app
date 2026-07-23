import { createLoader, parseAsStringLiteral } from "nuqs/server";
import {
  MEDIA_KINDS,
  MEDIA_SOURCES,
  MODERATION_STATUSES,
} from "@/lib/validation/media";

/**
 * Media-library URL search params (D4), owned with **nuqs**. This is the single
 * source of truth for the filter query string, shared by the server page (via
 * `loadMediaFilters`) and the client filter row (via `useQueryStates`) — §4.
 *
 * The facet vocabularies come from the canonical `media_assets` lists in
 * `@/lib/validation/media` (they mirror the DB CHECK columns) — no re-listing
 * here. The `moderation` URL key maps to `moderation_status`. Each parser yields
 * the literal or null (absent/invalid → null → unfiltered), so a hand-edited
 * query degrades cleanly.
 */
export const mediaFilterParsers = {
  kind: parseAsStringLiteral(MEDIA_KINDS),
  source: parseAsStringLiteral(MEDIA_SOURCES),
  moderation: parseAsStringLiteral(MODERATION_STATUSES),
};

/** Server-side loader — Next 16's `searchParams` is a Promise, which the loader
 * awaits and returns the typed `{ kind, source, moderation }` (each literal|null). */
export const loadMediaFilters = createLoader(mediaFilterParsers);
