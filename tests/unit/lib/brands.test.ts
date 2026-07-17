import { describe, expect, it } from "vitest";
import { isValidTimeZone } from "@/lib/timezones";
import { createBrandSchema } from "@/lib/validation/brands";

/**
 * B1 seam 1 (pure): brand input validation + timezone check. Boundaries only —
 * behaviour, not implementation.
 */
describe("isValidTimeZone", () => {
  it("accepts real IANA zones and the UTC fallback", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true); // the DB default (§ not in supportedValuesOf)
  });

  it("rejects bogus, empty, and non-string input", () => {
    expect(isValidTimeZone("Foo/Bar")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("not a zone")).toBe(false);
  });
});

describe("createBrandSchema", () => {
  it("accepts a valid name + timezone and trims the name", () => {
    const parsed = createBrandSchema.parse({
      name: "  Acme Agency  ",
      timezone: "America/New_York",
    });
    expect(parsed).toEqual({
      name: "Acme Agency",
      timezone: "America/New_York",
    });
  });

  it("rejects a name shorter than 2 chars (after trim)", () => {
    expect(
      createBrandSchema.safeParse({ name: "a", timezone: "UTC" }).success,
    ).toBe(false);
    expect(
      createBrandSchema.safeParse({ name: "  x  ", timezone: "UTC" }).success,
    ).toBe(false);
  });

  it("accepts a 2-char and 80-char name, rejects 81", () => {
    expect(
      createBrandSchema.safeParse({ name: "ab", timezone: "UTC" }).success,
    ).toBe(true);
    expect(
      createBrandSchema.safeParse({ name: "a".repeat(80), timezone: "UTC" })
        .success,
    ).toBe(true);
    expect(
      createBrandSchema.safeParse({ name: "a".repeat(81), timezone: "UTC" })
        .success,
    ).toBe(false);
  });

  it("rejects a bogus or missing timezone", () => {
    expect(
      createBrandSchema.safeParse({ name: "Acme", timezone: "Foo/Bar" })
        .success,
    ).toBe(false);
    expect(createBrandSchema.safeParse({ name: "Acme" }).success).toBe(false);
  });
});
