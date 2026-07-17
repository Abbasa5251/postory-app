/**
 * List-input parsing (B2). Isomorphic — the brand voice inputs use these to
 * turn textareas into clean arrays for preview, and the server voice schema
 * runs the same normalization on the received arrays, so client and server
 * always agree on the stored shape.
 */

/** Trim, drop empties, dedupe case-insensitively (first casing wins). */
export function normalizeList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Strip leading '#'(s) and surrounding whitespace from one hashtag token. */
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim();
}

/** Normalize a list of hashtag tokens: strip '#', drop empties, dedupe (CI). */
export function normalizeHashtagList(items: string[]): string[] {
  return normalizeList(items.map(normalizeHashtag));
}

/** Textarea text → clean list, split on newlines (banned words, sample posts). */
export function linesToList(text: string): string[] {
  return normalizeList(text.split(/\r?\n/));
}

/** Textarea text → clean hashtag list, split on whitespace/commas/newlines. */
export function parseHashtags(text: string): string[] {
  return normalizeHashtagList(text.split(/[\s,]+/));
}
