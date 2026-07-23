import { createLoader, parseAsStringLiteral } from "nuqs/server";

/**
 * Media-library URL search params (D4), owned with **nuqs**. This is the single
 * source of truth for the filter query string, shared by the server page (via
 * `loadMediaFilters`) and the client filter row (via `useQueryStates`) — §4.
 *
 * Facet vocabularies mirror the `media_assets` CHECK columns; the `moderation`
 * URL key maps to `moderation_status`. Each parser yields the literal or null
 * (absent/invalid → null → unfiltered), so a hand-edited query degrades cleanly.
 */
export const MEDIA_KINDS = ["image", "video"] as const;
export const MEDIA_SOURCES = ["upload", "generated"] as const;
export const MEDIA_MODERATIONS = ["pending", "passed", "blocked"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaSource = (typeof MEDIA_SOURCES)[number];
export type MediaModeration = (typeof MEDIA_MODERATIONS)[number];

export const mediaFilterParsers = {
  kind: parseAsStringLiteral(MEDIA_KINDS),
  source: parseAsStringLiteral(MEDIA_SOURCES),
  moderation: parseAsStringLiteral(MEDIA_MODERATIONS),
};

/** Server-side loader — Next 16's `searchParams` is a Promise, which the loader
 * awaits and returns the typed `{ kind, source, moderation }` (each literal|null). */
export const loadMediaFilters = createLoader(mediaFilterParsers);
