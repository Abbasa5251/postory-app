import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { brands } from "@/db/schemas/brands";
import { assertBrandAccess, brandScope, orgScope } from "@/server/dal/scope";
import type { AuthCtx, MemberCtx, SystemCtx } from "@/server/dal/types";
import { NotFoundError } from "@/server/domain/errors";

// No db mock needed: scope.ts builds SQL fragments, it never executes them.
const dialect = new PgDialect();
const render = (sql: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(sql);

const memberCtx = (brandIds: MemberCtx["brandIds"]): AuthCtx => ({
  orgId: "org_1",
  memberId: "member_1",
  role: "creator",
  brandIds,
});

const systemCtx: SystemCtx = {
  orgId: "org_1",
  role: "system",
  brandIds: "all",
  jobName: "test/job.run",
};

describe("orgScope", () => {
  it("renders the org_id predicate bound to ctx.orgId", () => {
    const query = render(orgScope(memberCtx("all"), brands));
    expect(query.sql).toBe('"brands"."org_id" = $1');
    expect(query.params).toEqual(["org_1"]);
  });

  it("works identically for a system ctx", () => {
    const query = render(orgScope(systemCtx, brands));
    expect(query.params).toEqual(["org_1"]);
  });
});

describe("assertBrandAccess", () => {
  it('passes for "all" access', () => {
    expect(() => assertBrandAccess(memberCtx("all"), "b1")).not.toThrow();
  });

  it("passes for an assigned brand", () => {
    expect(() =>
      assertBrandAccess(memberCtx(["b1", "b2"]), "b2"),
    ).not.toThrow();
  });

  it("throws NotFoundError (404-shaped, not Forbidden) for an unassigned brand", () => {
    expect(() => assertBrandAccess(memberCtx(["b1"]), "b9")).toThrow(
      NotFoundError,
    );
  });

  it("throws NotFoundError when the ctx has zero assigned brands", () => {
    expect(() => assertBrandAccess(memberCtx([]), "b1")).toThrow(NotFoundError);
  });

  it("passes for a system ctx (full brand access)", () => {
    expect(() => assertBrandAccess(systemCtx, "b1")).not.toThrow();
  });
});

describe("brandScope", () => {
  it('returns undefined for "all" so and() drops it', () => {
    expect(brandScope(memberCtx("all"), brands.id)).toBeUndefined();
  });

  it("renders an IN filter for assigned brands", () => {
    const query = render(brandScope(memberCtx(["b1", "b2"]), brands.id)!);
    expect(query.sql).toBe('"brands"."id" in ($1, $2)');
    expect(query.params).toEqual(["b1", "b2"]);
  });

  it("renders SQL false for zero assigned brands — matches nothing, never everything", () => {
    const query = render(brandScope(memberCtx([]), brands.id)!);
    expect(query.sql).toBe("false");
    expect(query.params).toEqual([]);
  });
});
