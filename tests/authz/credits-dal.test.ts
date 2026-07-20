import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveRate,
  getBalance,
  grantTrialCredits,
  refundCredits,
  reserveCredits,
} from "@/server/dal/credits";
import { NotFoundError } from "@/server/domain/errors";
import { systemCtx } from "../helpers/ctx";
import {
  captureInserts,
  makeBatch,
  makeSelectChain,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the credits DAL (C2, §13 hotspot). Every
 * org-scoped query renders an org_id predicate bound to ctx.orgId; every ledger
 * write sets org_id + delta + reason from the ctx (never input) and pairs an
 * audit row. getActiveRate is the documented §6.4 exception (credit_rates is
 * GLOBAL config, not tenant data). New method here → tests/authz/README.md.
 */

const { select, insert, batch } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert, batch } }));

beforeEach(() => vi.clearAllMocks());

// Credits are written by the Inngest worker (SystemCtx) and the trial grant at
// org creation (SystemCtx); getBalance is also read by member-facing code.
const ctx = systemCtx();

function type(values: unknown) {
  return values as Record<string, unknown>;
}

describe("getBalance — org-scoped SUM over the ledger", () => {
  it("filters on org_id = ctx.orgId", async () => {
    const chain = makeSelectChain(select, [{ balance: "150" }]);
    const balance = await getBalance(ctx);
    expect(balance).toBe(150);
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
  });

  it("coalesces an empty ledger to 0", async () => {
    makeSelectChain(select, [{ balance: 0 }]);
    expect(await getBalance(ctx)).toBe(0);
  });
});

describe("getActiveRate — global config (NOT org-scoped), by action + active", () => {
  it("filters on action and is_active, returns the model + credits", async () => {
    const chain = makeSelectChain(select, [
      { modelId: "anthropic/claude-haiku-4.5", credits: 1 },
    ]);
    const rate = await getActiveRate("copy");
    expect(rate).toEqual({ modelId: "anthropic/claude-haiku-4.5", credits: 1 });
    const { sql, params } = renderedWhere(chain);
    // Deliberately no org_id (credit_rates is global) — action-scoped instead.
    expect(sql).toContain("action");
    expect(sql).toContain("is_active");
    expect(params).toContain("copy");
    expect(sql).not.toContain("org_id");
  });

  it("404s when no active rate is seeded for the action", async () => {
    makeSelectChain(select, []);
    await expect(getActiveRate("copy")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reserveCredits — append-only debit + audit, org_id from ctx", () => {
  it("writes a negative-delta 'debit' row and a credit.reserve audit", async () => {
    const inserts = captureInserts(insert, [{ id: "led_1" }]);
    makeBatch(batch);
    await reserveCredits(ctx, { jobId: "job_1", credits: 3 });

    const debit = inserts.find((c) => type(c.values).reason === "debit");
    expect(debit).toBeDefined();
    expect(type(debit!.values).orgId).toBe("org_1");
    expect(type(debit!.values).delta).toBe(-3); // reserve = debit
    expect(type(debit!.values).refId).toBe("job_1");

    expect(
      inserts.some((c) => type(c.values).action === "credit.reserve"),
    ).toBe(true);
  });
});

describe("refundCredits — append-only positive refund + audit", () => {
  it("writes a positive-delta 'refund' row and a credit.refund audit", async () => {
    const inserts = captureInserts(insert, [{ id: "led_2" }]);
    makeBatch(batch);
    await refundCredits(ctx, { jobId: "job_1", credits: 3 });

    const refund = inserts.find((c) => type(c.values).reason === "refund");
    expect(refund).toBeDefined();
    expect(type(refund!.values).orgId).toBe("org_1");
    expect(type(refund!.values).delta).toBe(3);
  });

  it("no-ops when credits <= 0 (nothing to refund)", async () => {
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await refundCredits(ctx, { jobId: "job_1", credits: 0 });
    expect(inserts).toHaveLength(0);
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("grantTrialCredits — idempotent one-time trial grant", () => {
  it("grants 150 (trial_grant) when none exists yet", async () => {
    makeSelectChain(select, []); // no existing trial_grant
    const inserts = captureInserts(insert, [{ id: "led_3" }]);
    makeBatch(batch);
    await grantTrialCredits(ctx);

    const grant = inserts.find((c) => type(c.values).reason === "trial_grant");
    expect(grant).toBeDefined();
    expect(type(grant!.values).orgId).toBe("org_1");
    expect(type(grant!.values).delta).toBe(150);
  });

  it("is a no-op when a trial_grant already exists (org-scoped check)", async () => {
    const chain = makeSelectChain(select, [{ id: "led_existing" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await grantTrialCredits(ctx);
    // The existence check is org-scoped.
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    // Idempotent: nothing written.
    expect(inserts).toHaveLength(0);
    expect(batch).not.toHaveBeenCalled();
  });
});
