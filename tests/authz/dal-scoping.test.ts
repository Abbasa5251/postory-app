import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrandById, listBrands } from "@/server/dal/brands";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import { makeSelectChain, renderedWhere } from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof: every exported DAL query renders an org_id
 * predicate bound to ctx.orgId, so no method can ship unscoped (ADR-002).
 * Query BEHAVIOUR against a real two-org dataset is the deferred live layer
 * (see the it.todo block below). Adding a DAL method? Add its case here —
 * tests/authz/README.md is the checklist.
 */

// The db client is mocked, not imported (AGENTS.md §6 boundary; the hoisted
// spy must live in this file — vitest hoists vi.mock per-module).
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db/db", () => ({ db: { select } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brands DAL — org scoping is structurally present", () => {
  it("listBrands (full access) filters on org_id = ctx.orgId", async () => {
    const chain = makeSelectChain(select, []);
    await listBrands(memberCtx({ role: "admin", brandIds: "all" }));

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.params).toEqual(["org_1"]);
  });

  it("listBrands (creator) adds the assigned-brand narrowing on top of org scoping", async () => {
    const chain = makeSelectChain(select, []);
    await listBrands(memberCtx({ role: "creator", brandIds: ["b1", "b2"] }));

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.sql).toContain('"brands"."id" in ($2, $3)');
    expect(query.params).toEqual(["org_1", "b1", "b2"]);
  });

  it("listBrands (creator with zero brands) renders false — matches nothing, never everything", async () => {
    const chain = makeSelectChain(select, []);
    await listBrands(memberCtx({ role: "creator", brandIds: [] }));

    const query = renderedWhere(chain);
    expect(query.sql).toContain("false");
    expect(query.params).toEqual(["org_1"]);
  });

  it("getBrandById scopes by org AND id", async () => {
    const chain = makeSelectChain(select, [{ id: "b1", orgId: "org_1" }]);
    const row = await getBrandById(
      memberCtx({ role: "approver", brandIds: "all" }),
      "b1",
    );

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"brands"."org_id" = $1');
    expect(query.sql).toContain('"brands"."id" = $2');
    expect(query.params).toEqual(["org_1", "b1"]);
    expect(row).toEqual({ id: "b1", orgId: "org_1" });
  });

  it("getBrandById: cross-org / nonexistent are the same 404-shaped NotFoundError", async () => {
    makeSelectChain(select, []); // org-scoped query finds nothing — other tenant or absent
    await expect(
      getBrandById(
        memberCtx({ role: "admin", brandIds: "all" }),
        "b_other_org",
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("getBrandById: creator with an unassigned brand is rejected BEFORE any query runs", async () => {
    makeSelectChain(select, [{ id: "b9" }]);
    await expect(
      getBrandById(memberCtx({ role: "creator", brandIds: ["b1"] }), "b9"),
    ).rejects.toThrow(NotFoundError);
    expect(select).not.toHaveBeenCalled();
  });
});

// Type-level guard: orgScope refuses tables without an org_id column, so a
// new DAL module can't even compile against an unscoped table.
describe("orgScope table constraint", () => {
  it("rejects tables lacking org_id at the type level", async () => {
    const { orgScope } = await import("@/server/dal/scope");
    const { user } = await import("@/db/schemas/auth");
    const ctx = memberCtx({ role: "admin", brandIds: "all" });
    // @ts-expect-error — user has no orgId column; this failing to compile IS the assertion.
    const build = () => orgScope(ctx, user);
    expect(build).toBeDefined();
  });
});

// ── Live two-org isolation (deferred) ──────────────────────────────────────
// Defense-in-depth on top of the mock-level proof above: exercise the DAL
// against a seeded Neon branch with two real orgs and assert one can never
// read the other's rows. Needs test-DB infra + GitHub secrets (a documented
// carry-over, pairs with the Playwright nightly — PRD §Epic-A carry-overs).
describe("live two-org isolation (seeded Neon branch — deferred)", () => {
  it.todo("org A's listBrands returns none of org B's brands");
  it.todo("org A's getBrandById on an org-B brand id throws NotFoundError");
  it.todo("a creator cannot read a brand outside its brand_members rows");
});
