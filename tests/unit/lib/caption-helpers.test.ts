import { describe, expect, it } from "vitest";
import {
  buildUtmUrl,
  detectHashtags,
  detectMentions,
  insertText,
} from "@/lib/caption-helpers";
import { utmFormSchema } from "@/lib/validation/posts";

/**
 * C6 caption helpers (pure). Boundaries only — cursor insertion, UTM URL
 * composition, and mention/hashtag detection.
 */

describe("insertText", () => {
  it("inserts at the caret when there is no selection", () => {
    const result = insertText("Hello world", 5, 5, " there");
    expect(result.value).toBe("Hello there world");
    expect(result.caret).toBe(11);
  });

  it("replaces the selected range", () => {
    const result = insertText("Hello world", 6, 11, "there");
    expect(result.value).toBe("Hello there");
    expect(result.caret).toBe(11);
  });

  it("appends at the end", () => {
    const result = insertText("Hello", 5, 5, "!");
    expect(result.value).toBe("Hello!");
    expect(result.caret).toBe(6);
  });

  it("clamps out-of-bounds indices instead of throwing", () => {
    // end past the length clamps to the length.
    const high = insertText("abc", 2, 99, "X");
    expect(high.value).toBe("abX");
    expect(high.caret).toBe(3);
    // negative start clamps to 0.
    const low = insertText("abc", -5, 1, "X");
    expect(low.value).toBe("Xbc");
    expect(low.caret).toBe(1);
  });
});

describe("buildUtmUrl", () => {
  it("appends the required utm params", () => {
    const url = buildUtmUrl("https://example.com/post", {
      source: "instagram",
      medium: "social",
      campaign: "spring_launch",
    });
    expect(url).toBe(
      "https://example.com/post?utm_source=instagram&utm_medium=social&utm_campaign=spring_launch",
    );
  });

  it("preserves an existing query string", () => {
    const url = buildUtmUrl("https://example.com/post?ref=abc", {
      source: "instagram",
      medium: "social",
      campaign: "launch",
    });
    expect(url).toContain("ref=abc");
    expect(url).toContain("utm_source=instagram");
  });

  it("encodes spaces and special characters", () => {
    const url = buildUtmUrl("https://example.com", {
      source: "news letter",
      medium: "email",
      campaign: "q3 & q4",
    });
    expect(url).toContain("utm_source=news+letter");
    expect(url).toContain("utm_campaign=q3+%26+q4");
  });

  it("includes optional term/content and omits blank ones", () => {
    const withOptional = buildUtmUrl("https://example.com", {
      source: "ig",
      medium: "social",
      campaign: "c",
      term: "shoes",
      content: "  ",
    });
    expect(withOptional).toContain("utm_term=shoes");
    expect(withOptional).not.toContain("utm_content");
  });
});

describe("detectMentions", () => {
  it("extracts and dedupes @handles case-insensitively", () => {
    expect(detectMentions("hey @acme and @Acme and @brand")).toEqual([
      "acme",
      "brand",
    ]);
  });

  it("ignores an @ inside an email address", () => {
    expect(detectMentions("contact foo@bar.com today")).toEqual([]);
  });

  it("ignores a bare @", () => {
    expect(detectMentions("just an @ sign")).toEqual([]);
  });

  it("strips a trailing dot", () => {
    expect(detectMentions("thanks @brand.")).toEqual(["brand"]);
  });
});

describe("detectHashtags", () => {
  it("extracts and dedupes #tags case-insensitively", () => {
    expect(detectHashtags("#Launch launch #launch #sale")).toEqual([
      "Launch",
      "sale",
    ]);
  });

  it("ignores a bare # and non-hashtag words", () => {
    expect(detectHashtags("plain words and a # sign")).toEqual([]);
  });
});

describe("utmFormSchema", () => {
  it("accepts a valid form", () => {
    const result = utmFormSchema.safeParse({
      baseUrl: "https://example.com",
      source: "ig",
      medium: "social",
      campaign: "launch",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid URL", () => {
    const result = utmFormSchema.safeParse({
      baseUrl: "not a url",
      source: "ig",
      medium: "social",
      campaign: "launch",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required param", () => {
    const result = utmFormSchema.safeParse({
      baseUrl: "https://example.com",
      source: "",
      medium: "social",
      campaign: "launch",
    });
    expect(result.success).toBe(false);
  });
});
