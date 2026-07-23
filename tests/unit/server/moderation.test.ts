import { describe, expect, it } from "vitest";
import { screenPrompt, verdictFromJudge } from "@/server/domain/moderation";

/**
 * D5 moderation domain logic (pure). The deterministic prompt blocklist and the
 * judge-verdict mapping — no I/O, no model call (the OpenRouter judge transport
 * is build-verified separately).
 */

describe("screenPrompt", () => {
  it("passes ordinary brand-marketing prompts", () => {
    const out = screenPrompt(
      "A flat-lay of an iced cold brew on a sunlit café table, warm tones.",
    );
    expect(out.blocked).toBe(false);
    expect(out.matched).toEqual([]);
  });

  it("blocks an unambiguous safety term and reports the match", () => {
    const out = screenPrompt("please generate child porn");
    expect(out.blocked).toBe(true);
    expect(out.matched).toContain("child porn");
  });

  it("is case-insensitive", () => {
    expect(screenPrompt("CHILD PORN").blocked).toBe(true);
  });

  it("matches on word boundaries so short tokens don't fire inside real words", () => {
    // "cp" is a blocklist term but must not match inside "copy" / "captions".
    expect(screenPrompt("write great copy and captions").blocked).toBe(false);
    // …but does match as a standalone token.
    expect(screenPrompt("make cp now").blocked).toBe(true);
  });

  it("does not treat the brand's own banned words as a safety block", () => {
    // 'cheap' is a plausible style banned-word, not a safety term.
    expect(screenPrompt("our cheap coffee is the best").blocked).toBe(false);
  });
});

describe("verdictFromJudge", () => {
  it("passes when the judge did not flag", () => {
    expect(verdictFromJudge({ flagged: false, categories: [] })).toEqual({
      status: "passed",
      reason: null,
    });
  });

  it("blocks with a joined category reason when flagged", () => {
    expect(
      verdictFromJudge({
        flagged: true,
        categories: ["violence/graphic", "hate"],
      }),
    ).toEqual({ status: "blocked", reason: "violence/graphic, hate" });
  });

  it("blocks with a fallback reason when flagged with no categories", () => {
    expect(verdictFromJudge({ flagged: true, categories: [] })).toEqual({
      status: "blocked",
      reason: "flagged by moderation",
    });
  });

  it("treats a fail-closed { flagged: true } as blocked (moderation infra failure)", () => {
    // The jobs pass this shape when the judge itself errored.
    expect(verdictFromJudge({ flagged: true, categories: [] }).status).toBe(
      "blocked",
    );
  });
});
