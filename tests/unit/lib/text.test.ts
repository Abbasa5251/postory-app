import { describe, expect, it } from "vitest";
import {
  normalizeHashtag,
  normalizeHashtagList,
  normalizeList,
  parseHashtags,
  linesToList,
} from "@/lib/text";

/** B2 seam 1 (pure): list-input parsing shared by the voice inputs + schema. */
describe("normalizeList", () => {
  it("trims, drops empties, dedupes case-insensitively (first casing wins)", () => {
    expect(normalizeList([" Free ", "free", "", "  ", "Bold"])).toEqual([
      "Free",
      "Bold",
    ]);
  });
});

describe("linesToList", () => {
  it("splits on newlines and normalizes", () => {
    expect(linesToList("one\n two \n\none\nthree")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
  it("keeps multi-word entries intact (banned phrases)", () => {
    expect(linesToList("cheap knockoff\nlimited time only")).toEqual([
      "cheap knockoff",
      "limited time only",
    ]);
  });
});

describe("normalizeHashtag", () => {
  it("strips leading hashes and whitespace", () => {
    expect(normalizeHashtag("  ##Sale ")).toBe("Sale");
    expect(normalizeHashtag("plain")).toBe("plain");
  });
});

describe("normalizeHashtagList / parseHashtags", () => {
  it("strips '#', dedupes case-insensitively", () => {
    expect(normalizeHashtagList(["#Sale", "sale", "New"])).toEqual([
      "Sale",
      "New",
    ]);
  });
  it("splits on whitespace, commas, and newlines", () => {
    expect(parseHashtags("#one, #two\n#three four")).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
