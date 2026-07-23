import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countMediaUsage,
  deleteMediaAsset,
  findOrphanGeneratedAssets,
  getMediaById,
  getMediaByIds,
  listMediaForBrand,
  recordGeneratedAsset,
  recordUpload,
} from "@/server/dal/media";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx, systemCtx } from "../helpers/ctx";
import {
  captureDelete,
  captureInserts,
  makeBatch,
  makeSelectChain,
  renderedSql,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the media DAL (C4 + D4). Every query is
 * org-scoped to ctx.orgId; the upload write sets org_id from the ctx and
 * source='upload'; brand access is asserted (creators 404 on unassigned
 * brands); mutations audit (media.create / media.delete). New method here →
 * tests/authz/README.md.
 */

const { select, insert, del, batch } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert, delete: del, batch } }));

beforeEach(() => vi.clearAllMocks());

const adminCtx = memberCtx({ role: "admin", brandIds: "all" });

function type(values: unknown) {
  return values as Record<string, unknown>;
}

const ASSET_ROW = {
  id: "media_1",
  brandId: "brand_1",
  kind: "image",
  source: "upload",
  r2Key: "org/org_1/brand/brand_1/abc.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  width: 1080,
  height: 1080,
  durationSeconds: null,
  moderationStatus: "pending",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
};

describe("recordUpload — writes org_id from ctx, audits, brand-access gated", () => {
  it("inserts an upload asset with org_id from ctx, source 'upload', audits media.create", async () => {
    const inserts = captureInserts(insert, [ASSET_ROW]);
    const result = await recordUpload(adminCtx, {
      brandId: "brand_1",
      kind: "image",
      r2Key: "org/org_1/brand/brand_1/abc.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 1080,
      height: 1080,
    });
    expect(result.id).toBe("media_1");

    const assetInsert = inserts.find((c) => "r2Key" in type(c.values));
    expect(type(assetInsert!.values).orgId).toBe("org_1");
    expect(type(assetInsert!.values).source).toBe("upload");
    expect(inserts.some((c) => type(c.values).action === "media.create")).toBe(
      true,
    );
  });

  it("404s (before any insert) when a creator targets an unassigned brand", async () => {
    const creatorCtx = memberCtx(); // creator, brandIds ["brand_1"]
    const inserts = captureInserts(insert, [ASSET_ROW]);
    await expect(
      recordUpload(creatorCtx, {
        brandId: "brand_2",
        kind: "image",
        r2Key: "org/org_1/brand/brand_2/x.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });
});

describe("recordGeneratedAsset — writes org_id from ctx + generation provenance, audits, brand-access gated", () => {
  const GENERATED_ROW = {
    ...ASSET_ROW,
    id: "media_gen_1",
    source: "generated",
    r2Key: "org/org_1/brand/brand_1/gen.png",
    mimeType: "image/png",
  };

  // The generation job the asset links to — the scoped lookup returns this
  // (org-scoped select) before the insert.
  const JOB_ROW = {
    id: "job_1",
    brandId: "brand_1",
    type: "image",
    modelId: "bytedance-seed/seedream-4.5",
    status: "running",
    creditsReserved: 6,
    creditsSettled: null,
    providerGenerationId: null,
    error: null,
  };

  it("inserts a generated asset with org_id from ctx, source 'generated', model + job id, audits media.create", async () => {
    makeSelectChain(select, [JOB_ROW]); // scoped generation-job lookup
    const inserts = captureInserts(insert, [GENERATED_ROW]);
    const result = await recordGeneratedAsset(adminCtx, {
      brandId: "brand_1",
      r2Key: "org/org_1/brand/brand_1/gen.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      sourceModel: "bytedance-seed/seedream-4.5",
      generationJobId: "job_1",
    });
    expect(result.id).toBe("media_gen_1");

    const assetInsert = inserts.find((c) => "r2Key" in type(c.values));
    expect(type(assetInsert!.values).orgId).toBe("org_1");
    expect(type(assetInsert!.values).source).toBe("generated");
    expect(type(assetInsert!.values).kind).toBe("image");
    expect(type(assetInsert!.values).sourceModel).toBe(
      "bytedance-seed/seedream-4.5",
    );
    expect(type(assetInsert!.values).generationJobId).toBe("job_1");
    expect(inserts.some((c) => type(c.values).action === "media.create")).toBe(
      true,
    );
  });

  it("404s (before any insert) when a creator targets an unassigned brand", async () => {
    const creatorCtx = memberCtx(); // creator, brandIds ["brand_1"]
    const inserts = captureInserts(insert, [GENERATED_ROW]);
    await expect(
      recordGeneratedAsset(creatorCtx, {
        brandId: "brand_2",
        r2Key: "org/org_1/brand/brand_2/gen.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        sourceModel: "m",
        generationJobId: "job_1",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });

  it("404s (before any insert) when the linked job is missing / cross-org", async () => {
    makeSelectChain(select, []); // scoped job lookup finds nothing
    const inserts = captureInserts(insert, [GENERATED_ROW]);
    await expect(
      recordGeneratedAsset(adminCtx, {
        brandId: "brand_1",
        r2Key: "org/org_1/brand/brand_1/gen.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        sourceModel: "m",
        generationJobId: "job_x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });

  it("404s (before any insert) when the job belongs to a different brand", async () => {
    makeSelectChain(select, [{ ...JOB_ROW, brandId: "brand_2" }]);
    const inserts = captureInserts(insert, [GENERATED_ROW]);
    await expect(
      recordGeneratedAsset(adminCtx, {
        brandId: "brand_1",
        r2Key: "org/org_1/brand/brand_1/gen.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        sourceModel: "m",
        generationJobId: "job_1",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });
});

describe("listMediaForBrand — org + brand scoped", () => {
  it("filters on org_id = ctx.orgId and the brand id", async () => {
    const chain = makeSelectChain(select, [ASSET_ROW]);
    await listMediaForBrand(adminCtx, "brand_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("brand_1");
  });

  it("404s when a creator lists an unassigned brand (before any query)", async () => {
    const creatorCtx = memberCtx();
    await expect(
      listMediaForBrand(creatorCtx, "brand_2"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(select).not.toHaveBeenCalled();
  });

  it("adds facet predicates (kind/source/moderation) to the where clause", async () => {
    const chain = makeSelectChain(select, [ASSET_ROW]);
    await listMediaForBrand(adminCtx, "brand_1", {
      kind: "image",
      source: "generated",
      moderationStatus: "blocked",
    });
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("brand_1");
    // The facet values render as bound params.
    expect(params).toContain("image");
    expect(params).toContain("generated");
    expect(params).toContain("blocked");
  });
});

describe("countMediaUsage — org-scoped usage aggregate", () => {
  it("returns an empty map for no ids without querying", async () => {
    const result = await countMediaUsage(adminCtx, []);
    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("scopes to org_id and returns a per-asset count (coerced to number)", async () => {
    const chain = makeSelectChain(select, [
      { id: "media_1", uses: "2" },
      { id: "media_2", uses: "0" },
    ]);
    const result = await countMediaUsage(adminCtx, ["media_1", "media_2"]);
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(result.get("media_1")).toBe(2);
    expect(result.get("media_2")).toBe(0);
  });
});

describe("deleteMediaAsset — org-scoped delete + audit", () => {
  it("scopes the delete to org_id + id, audits media.delete, returns r2Key + verified brandId", async () => {
    makeSelectChain(select, [ASSET_ROW]); // getMediaById scoped fetch
    const deleteCall = captureDelete(del, [{ id: "media_1" }]);
    const inserts = captureInserts(insert, [{ id: "audit_1" }]);
    makeBatch(batch);

    const result = await deleteMediaAsset(adminCtx, "media_1");
    expect(result.r2Key).toBe(ASSET_ROW.r2Key);
    expect(result.brandId).toBe(ASSET_ROW.brandId);

    const { sql, params } = renderedSql(deleteCall.where!);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("media_1");
    expect(inserts.some((c) => type(c.values).action === "media.delete")).toBe(
      true,
    );
  });

  it("404s (before delete) when the asset is nonexistent / cross-org", async () => {
    makeSelectChain(select, []); // getMediaById finds nothing
    captureDelete(del, []);
    makeBatch(batch);
    await expect(deleteMediaAsset(adminCtx, "media_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("404s when a creator deletes an asset on an unassigned brand", async () => {
    const creatorCtx = memberCtx();
    makeSelectChain(select, [{ ...ASSET_ROW, brandId: "brand_2" }]);
    captureDelete(del, []);
    makeBatch(batch);
    await expect(
      deleteMediaAsset(creatorCtx, "media_1"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(del).not.toHaveBeenCalled();
  });

  it("404s when the delete matches 0 rows (raced)", async () => {
    makeSelectChain(select, [ASSET_ROW]);
    captureDelete(del, []); // 0-row delete
    makeBatch(batch);
    await expect(deleteMediaAsset(adminCtx, "media_1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("findOrphanGeneratedAssets — org-scoped orphan query", () => {
  it("scopes to org_id, filters source='generated', and correlates on media_ids", async () => {
    const chain = makeSelectChain(select, [
      { id: "media_gen_1", r2Key: "org/org_1/brand/brand_1/gen.png" },
    ]);
    const result = await findOrphanGeneratedAssets(systemCtx(), {
      olderThan: new Date("2026-07-16T00:00:00.000Z"),
      limit: 200,
    });
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("generated");
    // The correlated NOT EXISTS references post_versions.media_ids.
    expect(sql.toLowerCase()).toContain("not exists");
    expect(sql).toContain("media_ids");
    expect(result).toHaveLength(1);
    expect(result[0]!.r2Key).toBe("org/org_1/brand/brand_1/gen.png");
  });
});

describe("getMediaByIds — org-scoped", () => {
  it("filters on org_id and returns nothing for an empty id list without querying", async () => {
    const result = await getMediaByIds(adminCtx, []);
    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("scopes the lookup to org_id = ctx.orgId", async () => {
    const chain = makeSelectChain(select, [ASSET_ROW]);
    await getMediaByIds(adminCtx, ["media_1"]);
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("media_1");
  });
});

describe("getMediaById — org-scoped, brand access enforced", () => {
  it("filters on org_id = ctx.orgId and the asset id", async () => {
    const chain = makeSelectChain(select, [ASSET_ROW]);
    await getMediaById(adminCtx, "media_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("media_1");
  });

  it("404s when no row matches (nonexistent / cross-org)", async () => {
    makeSelectChain(select, []);
    await expect(getMediaById(adminCtx, "media_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("404s when the asset belongs to an unassigned brand (creator)", async () => {
    const creatorCtx = memberCtx();
    makeSelectChain(select, [{ ...ASSET_ROW, brandId: "brand_2" }]);
    await expect(getMediaById(creatorCtx, "media_1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
