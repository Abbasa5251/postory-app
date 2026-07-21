import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMediaById,
  getMediaByIds,
  listMediaForBrand,
  recordUpload,
} from "@/server/dal/media";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import {
  captureInserts,
  makeSelectChain,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the media DAL (C4). Every query is org-scoped
 * to ctx.orgId; the upload write sets org_id from the ctx and source='upload';
 * brand access is asserted (creators 404 on unassigned brands); the mutation
 * audits media.create. New method here → tests/authz/README.md.
 */

const { select, insert } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert } }));

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
