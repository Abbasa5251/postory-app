import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/server/domain/errors";
import { orphanMediaCleanupJob } from "@/server/jobs/media/orphan.cleanup";

/**
 * Job-level test for the orphan-media cleanup cron (D4) using the official
 * `@inngest/test` engine — it runs the real function through its `step.run`
 * boundaries with the DAL/storage collaborators mocked. Proves: it enumerates
 * orgs and sweeps each under a per-org system ctx; it deletes each orphan's row
 * then object; it uses a 30-day grace window; a benign delete race is skipped
 * (not fatal); and a storage-delete miss is best-effort (logged, still counted).
 */

const {
  listOrgIdsForSweep,
  findOrphanGeneratedAssets,
  deleteMediaAsset,
  deleteObject,
  logWarn,
  logError,
} = vi.hoisted(() => ({
  listOrgIdsForSweep: vi.fn(),
  findOrphanGeneratedAssets: vi.fn(),
  deleteMediaAsset: vi.fn(),
  deleteObject: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/server/dal/org", () => ({ listOrgIdsForSweep }));
vi.mock("@/server/dal/media", () => ({
  findOrphanGeneratedAssets,
  deleteMediaAsset,
}));
vi.mock("@/server/services/storage", () => ({ deleteObject }));
vi.mock("@/server/services/observability", () => ({
  log: { info: vi.fn(), warn: logWarn, error: logError, debug: vi.fn() },
}));
// Pure ctx factory — mock so the test doesn't load the whole auth stack.
vi.mock("@/server/auth/context", () => ({
  getSystemCtx: (orgId: string, jobName: string) => ({
    orgId,
    role: "system",
    brandIds: "all",
    jobName,
  }),
}));

beforeEach(() => vi.clearAllMocks());

const DAY_MS = 24 * 60 * 60 * 1000;

describe("orphanMediaCleanupJob", () => {
  it("sweeps every org and deletes each orphan's row + object", async () => {
    listOrgIdsForSweep.mockResolvedValue(["org_1", "org_2"]);
    findOrphanGeneratedAssets.mockImplementation((ctx: { orgId: string }) =>
      ctx.orgId === "org_1"
        ? Promise.resolve([
            { id: "m1", r2Key: "k1" },
            { id: "m2", r2Key: "k2" },
          ])
        : Promise.resolve([{ id: "m3", r2Key: "k3" }]),
    );
    deleteMediaAsset.mockImplementation((_ctx: unknown, id: string) =>
      Promise.resolve({ r2Key: `key-${id}`, brandId: "brand_1" }),
    );
    deleteObject.mockResolvedValue(undefined);

    const engine = new InngestTestEngine({ function: orphanMediaCleanupJob });
    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    expect(result).toEqual({ orgs: 2, deleted: 3 });

    // Each orphan's row was deleted, then its (returned) object key.
    expect(deleteMediaAsset).toHaveBeenCalledTimes(3);
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual([
      "key-m1",
      "key-m2",
      "key-m3",
    ]);

    // Per-org system ctx + a 200 cap were passed to the orphan query.
    const firstCtx = findOrphanGeneratedAssets.mock.calls[0]![0] as {
      orgId: string;
      role: string;
    };
    expect(firstCtx.orgId).toBe("org_1");
    expect(firstCtx.role).toBe("system");
    expect(findOrphanGeneratedAssets.mock.calls[0]![1]).toMatchObject({
      limit: 200,
    });
  });

  it("uses a 30-day grace window for the orphan cutoff", async () => {
    listOrgIdsForSweep.mockResolvedValue(["org_1"]);
    findOrphanGeneratedAssets.mockResolvedValue([]);

    const engine = new InngestTestEngine({ function: orphanMediaCleanupJob });
    await engine.execute();
    const after = Date.now();

    const { olderThan } = findOrphanGeneratedAssets.mock.calls[0]![1] as {
      olderThan: Date;
    };
    const age = after - olderThan.getTime();
    // ~30 days old, within the wall-clock jitter of the run (not 7).
    expect(age).toBeGreaterThanOrEqual(30 * DAY_MS - 5000);
    expect(age).toBeLessThanOrEqual(30 * DAY_MS + 5000);
  });

  it("skips a raced (already-deleted) orphan without failing the sweep", async () => {
    listOrgIdsForSweep.mockResolvedValue(["org_1"]);
    findOrphanGeneratedAssets.mockResolvedValue([
      { id: "m1", r2Key: "k1" },
      { id: "m2", r2Key: "k2" },
    ]);
    deleteMediaAsset.mockImplementation((_ctx: unknown, id: string) =>
      id === "m1"
        ? Promise.reject(new NotFoundError("media_asset", id))
        : Promise.resolve({ r2Key: `key-${id}`, brandId: "brand_1" }),
    );
    deleteObject.mockResolvedValue(undefined);

    const engine = new InngestTestEngine({ function: orphanMediaCleanupJob });
    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    // m1 skipped (NotFound), only m2 counted + its object deleted.
    expect(result).toEqual({ orgs: 1, deleted: 1 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("key-m2");
  });

  it("is best-effort on a storage-delete miss (logs, still counts the row)", async () => {
    listOrgIdsForSweep.mockResolvedValue(["org_1"]);
    findOrphanGeneratedAssets.mockResolvedValue([{ id: "m1", r2Key: "k1" }]);
    deleteMediaAsset.mockResolvedValue({ r2Key: "key-m1", brandId: "brand_1" });
    deleteObject.mockRejectedValue(new Error("R2 unreachable"));

    const engine = new InngestTestEngine({ function: orphanMediaCleanupJob });
    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    // The row is gone; a stray object doesn't fail the sweep.
    expect(result).toEqual({ orgs: 1, deleted: 1 });
    expect(logWarn).toHaveBeenCalled();
  });

  it("isolates a failing org so later orgs still get swept", async () => {
    listOrgIdsForSweep.mockResolvedValue(["org_1", "org_2"]);
    findOrphanGeneratedAssets.mockImplementation((ctx: { orgId: string }) =>
      ctx.orgId === "org_1"
        ? Promise.reject(new Error("db unavailable"))
        : Promise.resolve([{ id: "m3", r2Key: "k3" }]),
    );
    deleteMediaAsset.mockResolvedValue({ r2Key: "key-m3", brandId: "brand_2" });
    deleteObject.mockResolvedValue(undefined);

    const engine = new InngestTestEngine({ function: orphanMediaCleanupJob });
    const { result, error } = await engine.execute();

    // org_1 failed but was logged and skipped; org_2 still swept.
    expect(error).toBeUndefined();
    expect(result).toEqual({ orgs: 2, deleted: 1 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("key-m3");
    expect(logError).toHaveBeenCalled();
  });
});
