import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/db";
import { creditLedger, creditRates } from "@/db/schemas/billing";
import { NotFoundError } from "@/server/domain/errors";
import { TRIAL_GRANT_CREDITS } from "@/server/domain/credits";
import { buildAuditInsert } from "./audit";
import { orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Credits DAL (§13 hotspot; AGENTS.md §4/§8, ADR-005) — the ONLY place that
 * reads credit_rates and writes credit_ledger. The ledger is APPEND-ONLY (PG
 * triggers reject UPDATE/DELETE): reserve/refund are new rows, corrections are
 * compensating rows. Every write is org-scoped from the ctx (never input) and
 * pairs an audit entry.
 *
 * Ledger writes use the Case-A atomic template (dal/audit.ts): the audit's
 * entityId is the caller-known job/org id, NOT the DB-generated ledger id, so
 * the ledger insert and its audit run in one db.batch — closing the
 * "unacceptable residual" the audit doc flags for high-stakes credit writes.
 */

/** The billing action tiers priced in credit_rates (PRD §7.2). */
export type CreditAction =
  | "copy"
  | "image_standard"
  | "image_premium"
  | "video_standard"
  | "video_premium"
  // D5: the content-moderation judge model (0 credits — a gate, never billed;
  // read via getActiveRate("moderation") so the model id stays in config).
  // Mirrors the credit_rates_action_check CHECK widened in this migration.
  | "moderation";

/**
 * Current credit balance for the org: SUM(delta) over the ledger, excluding
 * expired grants (debits/refunds never expire, so they always count). This is
 * the on-write SUM; H4 adds the materialized cache + invalidation.
 */
export async function getBalance(ctx: AuthCtx): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)`,
    })
    .from(creditLedger)
    .where(
      and(
        orgScope(ctx, creditLedger),
        or(
          isNull(creditLedger.expiresAt),
          gt(creditLedger.expiresAt, sql`now()`),
        ),
      ),
    );
  return Number(row?.balance ?? 0);
}

/**
 * Credits still owed back for a generation job: the negated net of that job's
 * ledger rows (debit −c, refund +c), floored at 0. The ledger is the source of
 * truth for spend, so this is the authoritative amount to refund on failure —
 * correct no matter which step failed (a reserve that completed before the job
 * row's creditsReserved was set still shows here) and idempotent (0 once
 * refunded). Org-scoped.
 */
export async function outstandingReservation(
  ctx: AuthCtx,
  jobId: string,
): Promise<number> {
  const [row] = await db
    .select({ net: sql<string>`coalesce(sum(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(
      and(
        orgScope(ctx, creditLedger),
        eq(creditLedger.refType, "generation_job"),
        eq(creditLedger.refId, jobId),
      ),
    );
  return Math.max(0, -Number(row?.net ?? 0));
}

/**
 * The active model + credit price for a billing action (ADR-012 — model ids and
 * prices are never hardcoded). NOT org-scoped: credit_rates is GLOBAL config,
 * the documented §6.4 exception (like the table itself). Throws NotFoundError
 * when no active rate is seeded for the action.
 */
export async function getActiveRate(
  action: CreditAction,
): Promise<{ modelId: string; credits: number }> {
  const [row] = await db
    .select({ modelId: creditRates.modelId, credits: creditRates.credits })
    .from(creditRates)
    .where(and(eq(creditRates.action, action), eq(creditRates.isActive, true)))
    // Deterministic pick when several models share an action (D2 image tiers):
    // cheapest first, then by model id. 'copy' has exactly one.
    .orderBy(creditRates.credits, creditRates.modelId)
    .limit(1);
  if (!row) throw new NotFoundError("credit_rate", action);
  return row;
}

/**
 * Reserve (debit) credits BEFORE the OpenRouter call (§8, non-negotiable).
 * Append-only debit row + audit, atomically. The caller (the Inngest job) has
 * already checked the balance with assertSufficientBalance.
 */
export async function reserveCredits(
  ctx: AuthCtx,
  input: { jobId: string; credits: number },
): Promise<void> {
  await db.batch([
    db.insert(creditLedger).values({
      orgId: ctx.orgId,
      delta: -input.credits,
      reason: "debit",
      refType: "generation_job",
      refId: input.jobId,
    }),
    buildAuditInsert(ctx, {
      action: "credit.reserve",
      entityType: "generation_job",
      entityId: input.jobId,
      metadata: { credits: input.credits },
    }),
  ]);
}

/**
 * Refund (credit back) reserved credits — on total failure (full reservation)
 * or a partial settle (the unused remainder, see domain refundOnSettle).
 * OpenRouter doesn't bill failed generations, so a refund always balances the
 * earlier debit (ADR-012). No-op when credits <= 0.
 */
export async function refundCredits(
  ctx: AuthCtx,
  input: { jobId: string; credits: number },
): Promise<void> {
  if (input.credits <= 0) return;
  await db.batch([
    db.insert(creditLedger).values({
      orgId: ctx.orgId,
      delta: input.credits,
      reason: "refund",
      refType: "generation_job",
      refId: input.jobId,
    }),
    buildAuditInsert(ctx, {
      action: "credit.refund",
      entityType: "generation_job",
      entityId: input.jobId,
      metadata: { credits: input.credits },
    }),
  ]);
}

/**
 * Grant the one-time trial credits for a new org (D6/ADR-010, hardcoded pending
 * H1's real trial lifecycle). Idempotent: a second call is a no-op, so it is
 * safe to invoke on every org-creation path / retry. Called with a SystemCtx
 * (audited as actor 'system').
 */
export async function grantTrialCredits(ctx: AuthCtx): Promise<void> {
  const [existing] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      and(orgScope(ctx, creditLedger), eq(creditLedger.reason, "trial_grant")),
    )
    .limit(1);
  if (existing) return;
  await db.batch([
    db.insert(creditLedger).values({
      orgId: ctx.orgId,
      delta: TRIAL_GRANT_CREDITS,
      reason: "trial_grant",
      refType: "org",
      refId: ctx.orgId,
    }),
    buildAuditInsert(ctx, {
      action: "credit.trial_grant",
      entityType: "organization",
      entityId: ctx.orgId,
      metadata: { credits: TRIAL_GRANT_CREDITS },
    }),
  ]);
}
