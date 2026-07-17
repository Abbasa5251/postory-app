/**
 * IANA timezone helpers (B1). Isomorphic (no server-only) — the client brand
 * form sources its picker options from `supportedTimeZones`, and the server
 * validation schema rejects anything `isValidTimeZone` refuses (§7: the client
 * is hostile, so the timezone is re-checked server-side).
 */

/**
 * The canonical IANA zone list for the picker. Note: `Intl.supportedValuesOf`
 * omits the bare `"UTC"` alias (it ships `Etc/UTC`), which is why the DB
 * default `"UTC"` is validated via `isValidTimeZone` (below) rather than by
 * membership in this list.
 */
export const supportedTimeZones: readonly string[] =
  Intl.supportedValuesOf("timeZone");

/**
 * Picker options: the canonical IANA zones plus the bare `"UTC"` alias that
 * `Intl.supportedValuesOf` omits — so the browser-tz smart default and the DB
 * `UTC` fallback are always reselectable after clearing the field.
 */
export const timeZoneOptions: string[] = [
  "UTC",
  ...supportedTimeZones.filter((tz) => tz !== "UTC"),
];

/**
 * True if `tz` is a timezone the runtime accepts. Uses `Intl.DateTimeFormat`
 * rather than `supportedTimeZones.includes` so it also accepts valid aliases
 * outside the canonical list — notably the `"UTC"` fallback stored by
 * programmatic inserts. Rejects bogus strings and empty input.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
