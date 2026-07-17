import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createZernioProfile,
  deleteSocialAccountById,
  getSocialAccountById,
  getZernioProfileByBrand,
  insertSocialAccount,
  listSocialAccounts,
  syncSocialAccount,
} from "@/server/dal/accounts";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import {
  captureDelete,
  captureInserts,
  captureUpdate,
  makeBatch,
  makeSelectChain,
  renderedSql,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the accounts DAL (B3). Every exported query
 * renders an org_id predicate bound to ctx.orgId; every write sets org_id from
 * the ctx (never input); brand access is asserted (creators 404 on unassigned
 * brands). Adding a method here is the tests/authz/README.md checklist.
 */

const { select, insert, update, batch, del } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  batch: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/db/db", () => ({
  db: { select, insert, update, batch, delete: del },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// owner/admin/approver ctx (full brand access) — accounts management roles.
const adminCtx = memberCtx({ role: "admin", brandIds: "all" });

describe("accounts DAL — org scoping is structurally present", () => {
  it("listSocialAccounts filters on org_id = ctx.orgId (and brand)", async () => {
    const chain = makeSelectChain(select, []);
    await listSocialAccounts(adminCtx, "brand_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("brand_1");
  });

  it("getZernioProfileByBrand filters on org_id = ctx.orgId", async () => {
    const chain = makeSelectChain(select, []);
    await getZernioProfileByBrand(adminCtx, "brand_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
  });

  it("createZernioProfile writes org_id from ctx and audits", async () => {
    const calls = captureInserts(insert, [{ id: "zp_row_1" }]);
    await createZernioProfile(adminCtx, "brand_1", "zernio_abc");
    const profileInsert = calls.find(
      (c) => (c.values as { zernioProfileId?: string }).zernioProfileId,
    );
    expect((profileInsert!.values as { orgId: string }).orgId).toBe("org_1");
    // Paired audit (§6.6).
    expect(
      calls.some(
        (c) =>
          (c.values as { action?: string }).action ===
          "zernio_profile.provision",
      ),
    ).toBe(true);
  });

  it("insertSocialAccount writes org_id from ctx and audits account.connect on a real insert", async () => {
    const calls = captureInserts(insert, [{ id: "sa_1" }]);
    const row = await insertSocialAccount(adminCtx, {
      brandId: "brand_1",
      zernioProfileId: "zp_1",
      platform: "instagram",
      zernioAccountId: "za_1",
      handle: "@acme",
      avatarUrl: null,
      status: "connected",
    });
    expect(row).toEqual({ id: "sa_1" });
    const accountInsert = calls.find(
      (c) => (c.values as { zernioAccountId?: string }).zernioAccountId,
    );
    expect((accountInsert!.values as { orgId: string }).orgId).toBe("org_1");
    expect(
      calls.some(
        (c) => (c.values as { action?: string }).action === "account.connect",
      ),
    ).toBe(true);
  });

  it("insertSocialAccount is a no-op (null, no audit) when the account already exists", async () => {
    const calls = captureInserts(insert, []); // onConflictDoNothing → 0 rows
    const row = await insertSocialAccount(adminCtx, {
      brandId: "brand_1",
      zernioProfileId: "zp_1",
      platform: "instagram",
      zernioAccountId: "za_1",
      handle: "@acme",
      avatarUrl: null,
      status: "connected",
    });
    expect(row).toBeNull();
    expect(
      calls.some(
        (c) => (c.values as { action?: string }).action === "account.connect",
      ),
    ).toBe(false);
  });
});

describe("syncSocialAccount — org scoping is structurally present", () => {
  it("updates by (org_id = ctx.orgId, zernio_account_id) and audits", async () => {
    const upd = captureUpdate(update, [{ id: "sa_1" }]);
    captureInserts(insert); // audit insert inside the batch
    makeBatch(batch);
    const changed = await syncSocialAccount(adminCtx, {
      zernioAccountId: "za_1",
      handle: "@acme",
      avatarUrl: null,
      status: "needs_reauth",
    });
    expect(changed).toBe(true);
    const { sql, params } = renderedSql(upd.where!);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("za_1");
  });
});

describe("getSocialAccountById / deleteSocialAccountById — scoping (#31)", () => {
  it("getSocialAccountById filters on org_id, brand_id, and id", async () => {
    const chain = makeSelectChain(select, [
      { id: "sa_1", zernioAccountId: "za_1" },
    ]);
    await getSocialAccountById(adminCtx, "brand_1", "sa_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("brand_1");
    expect(params).toContain("sa_1");
  });

  it("getSocialAccountById 404s when no row matches", async () => {
    makeSelectChain(select, []);
    await expect(
      getSocialAccountById(adminCtx, "brand_1", "sa_x"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteSocialAccountById deletes by (org_id, id) and audits disconnect", async () => {
    const delCall = captureDelete(del, [{ id: "sa_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);
    await deleteSocialAccountById(adminCtx, "sa_1");
    const { sql, params } = renderedSql(delCall.where!);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("sa_1");
    expect(
      inserts.some(
        (c) =>
          (c.values as { action?: string }).action === "account.disconnect",
      ),
    ).toBe(true);
  });

  it("deleteSocialAccountById 404s on a 0-row delete (raced/cross-org)", async () => {
    captureDelete(del, []);
    captureInserts(insert);
    makeBatch(batch);
    await expect(
      deleteSocialAccountById(adminCtx, "sa_x"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("accounts DAL — brand access is enforced for creators", () => {
  // A creator narrowed to brand_1 (the memberCtx default) cannot touch brand_2.
  const creatorCtx = memberCtx(); // role creator, brandIds ["brand_1"]

  it("listSocialAccounts 404s on an unassigned brand", async () => {
    makeSelectChain(select, []);
    await expect(
      listSocialAccounts(creatorCtx, "brand_2"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getSocialAccountById 404s on an unassigned brand", async () => {
    makeSelectChain(select, [{ id: "sa_1" }]);
    await expect(
      getSocialAccountById(creatorCtx, "brand_2", "sa_1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("insertSocialAccount 404s on an unassigned brand", async () => {
    captureInserts(insert, [{ id: "sa_1" }]);
    await expect(
      insertSocialAccount(creatorCtx, {
        brandId: "brand_2",
        zernioProfileId: "zp_1",
        platform: "instagram",
        zernioAccountId: "za_1",
        handle: "@acme",
        avatarUrl: null,
        status: "connected",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
