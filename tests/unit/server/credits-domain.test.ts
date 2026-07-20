import { describe, expect, it } from "vitest";
import {
  TRIAL_GRANT_CREDITS,
  assertSufficientBalance,
  hasSufficientBalance,
  refundOnSettle,
} from "@/server/domain/credits";
import { InsufficientCreditsError } from "@/server/domain/errors";

/**
 * C2 credit math (AGENTS.md §8/§11 — credit ledger is tests-first). Pure, no
 * DB. The ledger writes (dal/credits.ts) are proven separately in
 * tests/authz/credits-dal.test.ts.
 */

describe("hasSufficientBalance", () => {
  it("is true when balance exceeds or equals cost (integers)", () => {
    expect(hasSufficientBalance(150, 1)).toBe(true);
    expect(hasSufficientBalance(1, 1)).toBe(true); // exact boundary
  });

  it("is false when balance is below cost, incl. zero/negative balances", () => {
    expect(hasSufficientBalance(0, 1)).toBe(false);
    expect(hasSufficientBalance(-5, 1)).toBe(false);
  });
});

describe("assertSufficientBalance", () => {
  it("does not throw when affordable", () => {
    expect(() => assertSufficientBalance(3, 3)).not.toThrow();
  });

  it("throws InsufficientCreditsError carrying required + available", () => {
    try {
      assertSufficientBalance(0, 3);
      throw new Error("expected assertSufficientBalance to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditsError);
      const e = err as InsufficientCreditsError;
      expect(e.code).toBe("INSUFFICIENT_CREDITS");
      expect(e.required).toBe(3);
      expect(e.available).toBe(0);
    }
  });
});

describe("refundOnSettle", () => {
  it("refunds nothing on a full-cost success (reserved === used)", () => {
    expect(refundOnSettle(1, 1)).toBe(0);
    expect(refundOnSettle(12, 12)).toBe(0);
  });

  it("refunds the unused remainder on a partial settle", () => {
    expect(refundOnSettle(12, 5)).toBe(7);
  });

  it("refunds the whole reservation on total failure (used === 0)", () => {
    expect(refundOnSettle(3, 0)).toBe(3);
  });

  it("never returns a negative refund (over-use is clamped, not re-charged)", () => {
    expect(refundOnSettle(1, 5)).toBe(0);
  });
});

describe("TRIAL_GRANT_CREDITS", () => {
  it("is the D6 trial cap of 150", () => {
    expect(TRIAL_GRANT_CREDITS).toBe(150);
  });
});
