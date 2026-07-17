import { describe, expect, it } from "vitest";
import { dedupeSlug, slugify } from "@/server/domain/brand-slug";

/**
 * B1 seam 1 (pure): brand slug derivation. Auto-derived from the name,
 * de-duplicated within the org (B1 grill decision — slug is immutable, routing
 * is by id). No DB, no mocks.
 */
describe("slugify", () => {
  it("lowercases and dashes a plain name", () => {
    expect(slugify("Acme Co")).toBe("acme-co");
  });

  it("collapses punctuation and whitespace runs, trims edge dashes", () => {
    expect(slugify("  Hello!! World  ")).toBe("hello-world");
    expect(slugify("Multiple   spaces & --- dashes")).toBe(
      "multiple-spaces-dashes",
    );
  });

  it("folds diacritics to their ascii base", () => {
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
  });

  it("uppercases fold to lowercase", () => {
    expect(slugify("ACME")).toBe("acme");
  });

  it("falls back to 'brand' when nothing slug-able remains", () => {
    expect(slugify("品牌")).toBe("brand");
    expect(slugify("!!!")).toBe("brand");
    expect(slugify("   ")).toBe("brand");
  });
});

describe("dedupeSlug", () => {
  it("returns the base when it is free", () => {
    expect(dedupeSlug("acme", [])).toBe("acme");
    expect(dedupeSlug("acme", ["other"])).toBe("acme");
  });

  it("appends the first free numeric suffix on collision", () => {
    expect(dedupeSlug("acme", ["acme"])).toBe("acme-2");
    expect(dedupeSlug("acme", ["acme", "acme-2"])).toBe("acme-3");
  });

  it("fills the first gap rather than the next-highest", () => {
    expect(dedupeSlug("acme", ["acme", "acme-3"])).toBe("acme-2");
  });

  it("collides case-insensitively", () => {
    expect(dedupeSlug("acme", ["ACME"])).toBe("acme-2");
  });
});
