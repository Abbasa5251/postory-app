import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignMember,
  listBrandIdsForMember,
  listBrandMemberIds,
  resolveCreatorBrandIds,
  unassignMember,
} from "@/server/dal/brand-members";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import {
  captureDelete,
  captureInserts,
  makeSelectChain,
  renderedSql,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * B5 Seam A — the Brand-Assignment DAL is org-scoped and self-audits, and the
 * assign path proves the target member belongs to the caller's org BEFORE any
 * write (there is no composite FK for `brand_members.member_id → org`, so this
 * guard is the tenancy boundary). Mock-level, mirroring dal-scoping.test.ts.
 */

const {
  select,
  insert,
  delete: del,
} = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert, delete: del } }));

const adminAll = () => memberCtx({ role: "admin", brandIds: "all" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listBrandMemberIds — org + brand scoped", () => {
  it("filters on org_id = ctx.orgId AND brand_id, returns the member ids", async () => {
    const chain = makeSelectChain(select, [
      { memberId: "m1" },
      { memberId: "m2" },
    ]);
    const ids = await listBrandMemberIds(adminAll(), "b1");

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brand_members"."org_id" = $1');
    expect(query.sql).toContain('"brand_members"."brand_id" = $2');
    expect(query.params).toEqual(["org_1", "b1"]);
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("rejects a caller without access to the brand before any query", async () => {
    makeSelectChain(select, []);
    await expect(
      listBrandMemberIds(
        memberCtx({ role: "creator", brandIds: ["b1"] }),
        "b9",
      ),
    ).rejects.toThrow(NotFoundError);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("listBrandIdsForMember — org + member scoped (B5.3)", () => {
  it("filters on org_id = ctx.orgId AND member_id, returns the brand ids", async () => {
    const chain = makeSelectChain(select, [
      { brandId: "b1" },
      { brandId: "b2" },
    ]);
    const ids = await listBrandIdsForMember(adminAll(), "member_9");

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brand_members"."org_id" = $1');
    expect(query.sql).toContain('"brand_members"."member_id" = $2');
    expect(query.params).toEqual(["org_1", "member_9"]);
    expect(ids).toEqual(["b1", "b2"]);
  });
});

describe("assignMember — target-member-in-org guard + audited insert", () => {
  it("guards on the member table scoped by org AND member id", async () => {
    const guard = makeSelectChain(select, [{ id: "member_9" }]);
    captureInserts(insert, [{ id: "bm_1" }]);

    await assignMember(adminAll(), "b1", "member_9");

    const query = renderedWhere(guard);
    expect(query.sql).toContain('"member"."organization_id" = $1');
    expect(query.sql).toContain('"member"."id" = $2');
    expect(query.params).toEqual(["org_1", "member_9"]);
  });

  it("rejects a target member that is not in the caller's org — before any insert", async () => {
    makeSelectChain(select, []); // member guard finds nobody in this org
    const inserts = captureInserts(insert, []);

    await expect(
      assignMember(adminAll(), "b1", "member_from_other_org"),
    ).rejects.toThrow(NotFoundError);
    expect(inserts).toHaveLength(0);
  });

  it("on a real insert writes org_id from ctx + brand + member, and pairs a brand.member.assign audit", async () => {
    makeSelectChain(select, [{ id: "member_9" }]);
    const inserts = captureInserts(insert, [{ id: "bm_1" }]);

    const row = await assignMember(adminAll(), "b1", "member_9");

    // Insert 1 — the brand_members row. org_id comes from ctx, never input.
    const bmInsert = inserts[0]!.values as Record<string, unknown>;
    expect(bmInsert.orgId).toBe("org_1");
    expect(bmInsert.brandId).toBe("b1");
    expect(bmInsert.memberId).toBe("member_9");

    // Insert 2 — the audit row (§6.6), attributed to the member from ctx.
    const audit = inserts[1]!.values as Record<string, unknown>;
    expect(audit.orgId).toBe("org_1");
    expect(audit.actorType).toBe("member");
    expect(audit.action).toBe("brand.member.assign");
    expect(audit.entityType).toBe("brand_member");
    expect(audit.entityId).toBe("bm_1");
    expect(audit.metadata).toEqual({ memberId: "member_9" });

    expect(row).toEqual({ id: "bm_1" });
  });

  it("is idempotent: a duplicate assignment inserts nothing new and writes no audit", async () => {
    makeSelectChain(select, [{ id: "member_9" }]);
    const inserts = captureInserts(insert, []); // onConflictDoNothing → no row

    const row = await assignMember(adminAll(), "b1", "member_9");

    // Only the (conflicting) brand_members insert was attempted — NO audit,
    // because nothing changed.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBeDefined();
    expect(row).toBeNull();
  });

  it("rejects a caller without access to the brand before the member guard", async () => {
    makeSelectChain(select, []);
    await expect(
      assignMember(
        memberCtx({ role: "creator", brandIds: ["b1"] }),
        "b9",
        "m1",
      ),
    ).rejects.toThrow(NotFoundError);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("resolveCreatorBrandIds — the getAuthCtx bootstrap read", () => {
  it("renders an org_id + member_id scoped query on brand_members and returns the brand ids", async () => {
    // The one documented §6 exception: raw orgId/memberId (it builds the ctx),
    // org-scoped by an explicit eq(orgId) rather than orgScope(). The orgId is
    // session-derived (getAuthCtx), never client input.
    const chain = makeSelectChain(select, [
      { brandId: "b1" },
      { brandId: "b2" },
    ]);

    const ids = await resolveCreatorBrandIds("org_1", "member_9");

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brand_members"."org_id" = $1');
    expect(query.sql).toContain('"brand_members"."member_id" = $2');
    expect(query.params).toEqual(["org_1", "member_9"]);
    expect(ids).toEqual(["b1", "b2"]);
  });

  it("a creator with no assignments resolves to an empty list (→ sees nothing)", async () => {
    makeSelectChain(select, []);
    await expect(resolveCreatorBrandIds("org_1", "member_9")).resolves.toEqual(
      [],
    );
  });
});

describe("unassignMember — org+brand+member-scoped delete, audited, idempotent", () => {
  it("deletes scoped by org AND brand AND member and pairs a brand.member.unassign audit", async () => {
    const delCall = captureDelete(del, [{ id: "bm_1" }]);
    const inserts = captureInserts(insert, [{ id: "audit_1" }]);

    const row = await unassignMember(adminAll(), "b1", "member_9");

    const where = renderedSql(delCall.where!);
    expect(where.sql).toContain('"brand_members"."org_id" = $1');
    expect(where.sql).toContain('"brand_members"."brand_id" = $2');
    expect(where.sql).toContain('"brand_members"."member_id" = $3');
    expect(where.params).toEqual(["org_1", "b1", "member_9"]);

    const audit = inserts[0]!.values as Record<string, unknown>;
    expect(audit.action).toBe("brand.member.unassign");
    expect(audit.entityType).toBe("brand_member");
    expect(audit.metadata).toEqual({ memberId: "member_9" });

    expect(row).toEqual({ id: "bm_1" });
  });

  it("a 0-row delete is an idempotent no-op: returns null and writes NO audit", async () => {
    captureDelete(del, []); // nothing assigned — already gone
    const inserts = captureInserts(insert, []);

    // Symmetric with assignMember's no-op: an action that changed nothing must
    // not emit a phantom brand.member.unassign event (code-review finding).
    await expect(
      unassignMember(adminAll(), "b1", "member_9"),
    ).resolves.toBeNull();
    expect(inserts).toHaveLength(0);
  });
});
