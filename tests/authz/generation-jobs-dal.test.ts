import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeJob,
  createJob,
  getById,
  startJob,
} from "@/server/dal/generation-jobs";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx, systemCtx } from "../helpers/ctx";
import {
  captureInserts,
  captureUpdate,
  makeBatch,
  makeSelectChain,
  renderedSql,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the generation-jobs DAL (C2). Every query is
 * org-scoped to ctx.orgId; writes set org_id from the ctx; brand access is
 * asserted (creators 404 on unassigned brands); each mutation audits. New
 * method here → tests/authz/README.md.
 */

const { select, insert, update, batch } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert, update, batch } }));

beforeEach(() => vi.clearAllMocks());

const adminCtx = memberCtx({ role: "admin", brandIds: "all" });
const sysCtx = systemCtx();

function type(values: unknown) {
  return values as Record<string, unknown>;
}

describe("createJob — writes org_id from ctx, audits, brand-access gated", () => {
  it("inserts a queued job with org_id from ctx and audits generation.create", async () => {
    const inserts = captureInserts(insert, [{ id: "job_1" }]);
    const result = await createJob(adminCtx, {
      brandId: "brand_1",
      type: "copy",
      modelId: "anthropic/claude-haiku-4.5",
    });
    expect(result).toEqual({ id: "job_1" });

    const jobInsert = inserts.find((c) => "type" in type(c.values));
    expect(type(jobInsert!.values).orgId).toBe("org_1");
    expect(type(jobInsert!.values).status).toBe("queued");
    expect(
      inserts.some((c) => type(c.values).action === "generation.create"),
    ).toBe(true);
  });

  it("404s (before any insert) when a creator targets an unassigned brand", async () => {
    const creatorCtx = memberCtx(); // creator, brandIds ["brand_1"]
    const inserts = captureInserts(insert, [{ id: "job_1" }]);
    await expect(
      createJob(creatorCtx, {
        brandId: "brand_2",
        type: "copy",
        modelId: "m",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });
});

describe("getById — org-scoped, brand access enforced", () => {
  it("filters on org_id = ctx.orgId and job id", async () => {
    const chain = makeSelectChain(select, [
      { id: "job_1", brandId: "brand_1", type: "copy", status: "running" },
    ]);
    await getById(adminCtx, "job_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("job_1");
  });

  it("404s when the job belongs to an unassigned brand (creator)", async () => {
    const creatorCtx = memberCtx();
    makeSelectChain(select, [
      { id: "job_1", brandId: "brand_2", type: "copy", status: "queued" },
    ]);
    await expect(getById(creatorCtx, "job_1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("404s when no row matches (nonexistent / cross-org)", async () => {
    makeSelectChain(select, []);
    await expect(getById(adminCtx, "job_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("startJob — org-scoped update + audit", () => {
  it("updates status/creditsReserved scoped to org_id and audits generation.start", async () => {
    const upd = captureUpdate(update, [{ id: "job_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await startJob(sysCtx, "job_1", { creditsReserved: 1 });
    const { sql, params } = renderedSql(upd.where!);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(type(upd.set).status).toBe("running");
    expect(type(upd.set).creditsReserved).toBe(1);
    // The batch pairs the update with a generation.start audit insert.
    expect(
      inserts.some((c) => type(c.values).action === "generation.start"),
    ).toBe(true);
  });

  it("404s when the update matches no row in the ctx org", async () => {
    captureUpdate(update, []); // 0 rows
    makeBatch(batch);
    await expect(
      startJob(sysCtx, "job_x", { creditsReserved: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("completeJob — terminal transition, org-scoped + audited", () => {
  it("sets succeeded + creditsSettled scoped to org_id and audits generation.succeeded", async () => {
    const upd = captureUpdate(update, [{ id: "job_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await completeJob(sysCtx, "job_1", {
      status: "succeeded",
      creditsSettled: 1,
    });
    const { sql, params } = renderedSql(upd.where!);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(type(upd.set).status).toBe("succeeded");
    expect(type(upd.set).creditsSettled).toBe(1);
    expect(
      inserts.some((c) => type(c.values).action === "generation.succeeded"),
    ).toBe(true);
  });

  it("records a failure with the error and audits generation.failed", async () => {
    const upd = captureUpdate(update, [{ id: "job_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await completeJob(sysCtx, "job_1", {
      status: "failed",
      creditsSettled: 0,
      error: "boom",
    });
    expect(type(upd.set).status).toBe("failed");
    expect(type(upd.set).error).toBe("boom");
    expect(
      inserts.some((c) => type(c.values).action === "generation.failed"),
    ).toBe(true);
  });
});
