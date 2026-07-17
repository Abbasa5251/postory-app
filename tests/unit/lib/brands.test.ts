import { describe, expect, it } from "vitest";
import { isValidTimeZone } from "@/lib/timezones";
import {
  createBrandSchema,
  updateBrandContactSchema,
  updateBrandSchema,
  updateBrandVoiceSchema,
  voiceProfileSchema,
} from "@/lib/validation/brands";

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

describe("updateBrandSchema", () => {
  it("requires id and validates name/timezone like create", () => {
    expect(
      updateBrandSchema.safeParse({ id: "b1", name: "Acme", timezone: "UTC" })
        .success,
    ).toBe(true);
    // missing id
    expect(
      updateBrandSchema.safeParse({ name: "Acme", timezone: "UTC" }).success,
    ).toBe(false);
    // shares the create name/timezone rules
    expect(
      updateBrandSchema.safeParse({ id: "b1", name: "a", timezone: "UTC" })
        .success,
    ).toBe(false);
    expect(
      updateBrandSchema.safeParse({ id: "b1", name: "Acme", timezone: "X/Y" })
        .success,
    ).toBe(false);
  });

  it("trims the name", () => {
    expect(
      updateBrandSchema.parse({ id: "b1", name: "  Acme  ", timezone: "UTC" }),
    ).toEqual({ id: "b1", name: "Acme", timezone: "UTC" });
  });
});

describe("voiceProfileSchema", () => {
  it("normalizes arrays: strips '#', trims, dedupes", () => {
    const parsed = voiceProfileSchema.parse({
      tone: "  warm, a little cheeky ",
      bannedWords: [" cheap ", "cheap", "spam"],
      hashtags: ["#Sale", "sale", "New"],
      samplePosts: ["Post one", " Post one "],
    });
    expect(parsed.tone).toBe("warm, a little cheeky");
    expect(parsed.bannedWords).toEqual(["cheap", "spam"]);
    expect(parsed.hashtags).toEqual(["Sale", "New"]);
    expect(parsed.samplePosts).toEqual(["Post one"]);
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(voiceProfileSchema.safeParse({}).success).toBe(true);
  });

  it("rejects over-limit input", () => {
    expect(
      voiceProfileSchema.safeParse({ tone: "x".repeat(501) }).success,
    ).toBe(false);
    expect(
      voiceProfileSchema.safeParse({ bannedWords: ["x".repeat(51)] }).success,
    ).toBe(false);
    expect(
      voiceProfileSchema.safeParse({
        bannedWords: Array.from({ length: 101 }, (_, i) => `w${i}`),
      }).success,
    ).toBe(false);
    expect(
      voiceProfileSchema.safeParse({
        hashtags: Array.from({ length: 31 }, (_, i) => `h${i}`),
      }).success,
    ).toBe(false);
    expect(
      voiceProfileSchema.safeParse({ samplePosts: ["x".repeat(2001)] }).success,
    ).toBe(false);
  });

  it("rejects a hashtag with illegal characters", () => {
    expect(
      voiceProfileSchema.safeParse({ hashtags: ["not a tag"] }).success,
    ).toBe(false);
  });
});

describe("updateBrandVoiceSchema", () => {
  it("requires id and collapses an all-empty profile to null", () => {
    expect(updateBrandVoiceSchema.safeParse({ voiceProfile: {} }).success).toBe(
      false,
    ); // no id
    const empty = updateBrandVoiceSchema.parse({
      id: "b1",
      voiceProfile: { bannedWords: [], hashtags: [], samplePosts: [] },
    });
    expect(empty.voiceProfile).toBeNull();
    const populated = updateBrandVoiceSchema.parse({
      id: "b1",
      voiceProfile: { tone: "warm" },
    });
    expect(populated.voiceProfile).toEqual({ tone: "warm" });
  });
});

describe("updateBrandContactSchema", () => {
  it("accepts a valid email, clears on empty, rejects invalid", () => {
    expect(
      updateBrandContactSchema.parse({
        id: "b1",
        clientContactEmail: " a@b.com ",
      }),
    ).toEqual({ id: "b1", clientContactEmail: "a@b.com" });
    expect(
      updateBrandContactSchema.parse({ id: "b1", clientContactEmail: "" }),
    ).toEqual({ id: "b1", clientContactEmail: null });
    expect(
      updateBrandContactSchema.safeParse({
        id: "b1",
        clientContactEmail: "nope",
      }).success,
    ).toBe(false);
    expect(
      updateBrandContactSchema.safeParse({ clientContactEmail: "a@b.com" })
        .success,
    ).toBe(false); // no id
  });
});
