/**
 * Deterministic brand accent color + initial for shell UI (A7 design system).
 * Brands have no dedicated accent column (only an opaque `colors` jsonb, unused
 * yet), so the sidebar's colored initial badge derives a stable color from the
 * brand id. Isomorphic-safe (lib/): no server imports.
 */

/** Palette drawn from the postory-design mockup workspace badges. */
const BRAND_ACCENTS = [
  "#0e7c7b",
  "#7a4a2b",
  "#2f4858",
  "#5b4fc4",
  "#9a5b00",
  "#1b7a46",
  "#0a66c2",
  "#c0362c",
] as const;

/** A stable accent hex for a brand, chosen by hashing its id. */
export function brandAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return BRAND_ACCENTS[hash % BRAND_ACCENTS.length];
}

/** First letter of a brand name for the badge, uppercased. */
export function brandInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
