import "server-only";
import { InsufficientCreditsError } from "./errors";

/**
 * Credit math (AGENTS.md §8, ADR-005) — pure, no I/O, exhaustively unit-tested.
 * The ledger writes themselves live in src/server/dal/credits.ts; this module
 * owns only the arithmetic and the reserve-before-run rule.
 *
 * Flow: reserve (debit `cost`) BEFORE the OpenRouter call → run → settle
 * (refund any unused) or, on failure, refund the whole reservation (OpenRouter
 * doesn't bill failed generations, ADR-012). For copy the cost is fixed, so a
 * successful settle refunds 0; the general `refundOnSettle` seam is what D2's
 * variable image cost will use.
 */

/**
 * Hardcoded trial grant (D6/ADR-010: 14-day trial, 150 credits). H1 owns the
 * real trial lifecycle (expiry, caps, reactivation); C2 grants this once at org
 * creation so a new org has a non-zero balance to generate against.
 */
export const TRIAL_GRANT_CREDITS = 150;

/** Whether a balance covers a cost. Credits are integers (AGENTS.md §9). */
export function hasSufficientBalance(balance: number, cost: number): boolean {
  return balance >= cost;
}

/**
 * Guard run BEFORE reserving/spending (§8). Throws InsufficientCreditsError —
 * a typed, user-safe domain error — so nothing is debited and no OpenRouter
 * call is made when the org can't afford the generation.
 */
export function assertSufficientBalance(balance: number, cost: number): void {
  if (!hasSufficientBalance(balance, cost)) {
    throw new InsufficientCreditsError(cost, balance);
  }
}

/**
 * Credits to refund when settling: reserved minus actually used, floored at 0
 * (never a negative "refund" that would silently re-charge). A total failure
 * settles with used = 0 → the whole reservation is refunded.
 */
export function refundOnSettle(reserved: number, used: number): number {
  return Math.max(0, reserved - used);
}
