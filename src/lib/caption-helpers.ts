import { normalizeList } from "@/lib/text";

/**
 * Caption-authoring helpers (C6). Isomorphic — no server imports, no secrets.
 * Pure functions behind the composer's emoji / UTM-link / mention toolbar; all
 * caption edits funnel through the composer's existing `setCaption` seam so
 * nothing here touches state or the DOM. Unit-tested directly (like
 * `platforms/preview.ts`).
 */

/** The result of a cursor insertion: the new value and where the caret lands. */
export type CaptionInsert = { value: string; caret: number };

/**
 * Splice `insert` into `value`, replacing any `[start, end)` selection, and
 * report where the caret should land (just after the inserted text). Ranges
 * are clamped so out-of-order or out-of-bounds selections can't throw — a bad
 * range degrades to an append rather than corrupting the caption.
 */
export function insertText(
  value: string,
  start: number,
  end: number,
  insert: string,
): CaptionInsert {
  const lo = Math.max(0, Math.min(start, end, value.length));
  const hi = Math.max(0, Math.min(Math.max(start, end), value.length));
  const next = value.slice(0, lo) + insert + value.slice(hi);
  return { value: next, caret: lo + insert.length };
}

/** UTM campaign parameters for a tracked link. */
export type UtmParams = {
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
};

/**
 * Append UTM campaign parameters to `baseUrl`, preserving any existing query
 * string and letting the URL API handle percent-encoding. Assumes `baseUrl`
 * is a valid absolute URL — the caller validates via `utmFormSchema` first.
 * Empty/whitespace optional params are omitted.
 */
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  const url = new URL(baseUrl);
  const pairs: [string, string | undefined][] = [
    ["utm_source", params.source],
    ["utm_medium", params.medium],
    ["utm_campaign", params.campaign],
    ["utm_term", params.term],
    ["utm_content", params.content],
  ];
  for (const [key, raw] of pairs) {
    const value = raw?.trim();
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

// A token must start at the string start or after whitespace so `foo@bar.com`
// isn't read as an `@bar` mention. Handles allow letters/digits/underscore/dot
// (dots for handles like `@some.brand`), trimmed of any trailing dot below.
const MENTION_RE = /(?:^|\s)@([A-Za-z0-9._]+)/g;
const HASHTAG_RE = /(?:^|\s)#([A-Za-z0-9_]+)/g;

function collectTokens(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(re)) {
    // Drop a trailing dot so "@brand." yields "brand".
    const token = match[1].replace(/\.+$/, "");
    if (token) out.push(token);
  }
  // normalizeList (§4 reuse) trims, drops empties, dedupes case-insensitively.
  return normalizeList(out);
}

/** Unique `@handle` tokens in a caption (the `@` excluded), boundary-aware. */
export function detectMentions(text: string): string[] {
  return collectTokens(text, MENTION_RE);
}

/** Unique `#hashtag` tokens in a caption (the `#` excluded), boundary-aware. */
export function detectHashtags(text: string): string[] {
  return collectTokens(text, HASHTAG_RE);
}
