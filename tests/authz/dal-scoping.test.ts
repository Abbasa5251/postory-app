import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getBrandById, listBrands } from "@/server/dal/brands";
import type { AuthCtx, MemberCtx } from "@/server/dal/types";
import { NotFoundError } from "@/server/domain/errors";

/**
 * Structural seed of the A8 authz matrix (mock-level): every exported DAL
 * query must render an org_id predicate bound to ctx.orgId — proof that no
 * method ships unscoped. Query BEHAVIOR against real SQL (live two-org
 * isolation) is A8's job, on a seeded Neon branch.
 */

// The db client is mocked, not imported (AGENTS.md §6 boundary; see
// audit-dal.test.ts for the rationale).
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db/db", () => ({ db: { select } }));

const dialect = new PgDialect();

type Chain = {
  from: Mock;
  where: Mock;
  orderBy: Mock;
  limit: Mock;
};

/** Chainable select mock resolving to `rows`; captures the where() argument. */
function mockSelect(rows: unknown[]): Chain {
  const chain: Chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  chain.limit.mockResolvedValue(rows);
  select.mockReturnValue(chain);
  return chain;
}

function renderedWhere(chain: Chain) {
  expect(chain.where).toHaveBeenCalledOnce();
  return dialect.sqlToQuery(chain.where.mock.calls[0]![0] as SQL);
}

const ctx = (
  brandIds: MemberCtx["brandIds"],
  role: MemberCtx["role"] = "creator",
): AuthCtx => ({
  orgId: "org_1",
  memberId: "member_1",
  role,
  brandIds,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brands DAL — org scoping is structurally present", () => {
  it("listBrands (full access) filters on org_id = ctx.orgId", async () => {
    const chain = mockSelect([]);
    await listBrands(ctx("all", "admin"));

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.params).toEqual(["org_1"]);
  });

  it("listBrands (creator) adds the assigned-brand narrowing on top of org scoping", async () => {
    const chain = mockSelect([]);
    await listBrands(ctx(["b1", "b2"]));

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.sql).toContain('"brands"."id" in ($2, $3)');
    expect(query.params).toEqual(["org_1", "b1", "b2"]);
  });

  it("listBrands (creator with zero brands) renders false — matches nothing, never everything", async () => {
    const chain = mockSelect([]);
    await listBrands(ctx([]));

    const query = renderedWhere(chain);
    expect(query.sql).toContain("false");
    expect(query.params).toEqual(["org_1"]);
  });

  it("getBrandById scopes by org AND id", async () => {
    const chain = mockSelect([{ id: "b1", orgId: "org_1" }]);
    const row = await getBrandById(ctx("all", "approver"), "b1");

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.sql).toContain('"brands"."id" = $2');
    expect(query.params).toEqual(["org_1", "b1"]);
    expect(row).toEqual({ id: "b1", orgId: "org_1" });
  });

  it("getBrandById: cross-org / nonexistent are the same 404-shaped NotFoundError", async () => {
    mockSelect([]); // org-scoped query finds nothing — other tenant or absent
    await expect(
      getBrandById(ctx("all", "admin"), "b_other_org"),
    ).rejects.toThrow(NotFoundError);
  });

  it("getBrandById: creator with an unassigned brand is rejected BEFORE any query runs", async () => {
    mockSelect([{ id: "b9" }]);
    await expect(getBrandById(ctx(["b1"]), "b9")).rejects.toThrow(
      NotFoundError,
    );
    expect(select).not.toHaveBeenCalled();
  });
});

// Type-level guard: orgScope refuses tables without an org_id column, so a
// new DAL module can't even compile against an unscoped table.
describe("orgScope table constraint", () => {
  it("rejects tables lacking org_id at the type level", async () => {
    const { orgScope } = await import("@/server/dal/scope");
    const { user } = await import("@/db/schemas/auth");
    // @ts-expect-error — user has no orgId column; this failing to compile IS the assertion.
    const build = () => orgScope(ctx("all", "admin"), user);
    expect(build).toBeDefined();
  });
});
