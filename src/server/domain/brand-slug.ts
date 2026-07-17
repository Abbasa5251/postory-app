import "server-only";

/**
 * Brand slug derivation (B1). Pure domain logic — no I/O, exhaustively unit
 * tested. The slug is auto-derived from the brand name, de-duplicated within
 * the org, and thereafter immutable (routing is by id, not slug — B1 grill).
 *
 * Related but distinct: `sanitizeSlug` in the org onboarding component
 * (client, "use client") sanitizes a *user-editable* org slug live as it's
 * typed, so it deliberately keeps edge dashes. This produces a *final* slug,
 * so it folds diacritics, collapses runs, and trims edge dashes. They are not
 * the same operation — do not merge them.
 */

// Combining diacritical marks (U+0300–U+036F), left over after NFKD splits an
// accented character into base + mark.
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Name → final slug: diacritic-folded, lowercase, dash-collapsed, edge-trimmed. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-alphanumerics → one dash
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
  // Names that are entirely non-latin (or punctuation) slugify to "" — give
  // them a stable base so dedupe can still disambiguate (brand, brand-2, …).
  return base || "brand";
}

/**
 * Given a base slug and the slugs already taken in the org, return the base if
 * free, else the first free `base-N` (N from 2). Fills gaps: given
 * {acme, acme-3} it returns acme-2, not acme-4. Case-insensitive.
 */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(Array.from(taken, (s) => s.toLowerCase()));
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
