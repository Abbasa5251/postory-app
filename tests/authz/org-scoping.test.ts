import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveOrgName,
  listOrgIdsForSweep,
  listOrgMembers,
} from "@/server/dal/org";
import { memberCtx } from "../helpers/ctx";
import { makeSelectChain, renderedWhere } from "../helpers/db-mock";

/**
 * Read-only DAL helpers over the better-auth org tables (AGENTS.md §6) are
 * org-scoped like every other DAL read — a caller can only ever enumerate its
 * own tenant's members. Mock-level, mirroring dal-scoping.test.ts.
 */

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db/db", () => ({ db: { select } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listOrgMembers — org-scoped read of better-auth members", () => {
  it("filters on member.organization_id = ctx.orgId and returns identity + role", async () => {
    const chain = makeSelectChain(select, [
      {
        id: "m1",
        userId: "u1",
        name: "Jordan",
        email: "jordan@example.com",
        role: "creator",
      },
    ]);

    const rows = await listOrgMembers(
      memberCtx({ role: "admin", brandIds: "all" }),
    );

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"member"."organization_id" = $1');
    expect(query.params).toEqual(["org_1"]);
    expect(rows).toEqual([
      {
        id: "m1",
        userId: "u1",
        name: "Jordan",
        email: "jordan@example.com",
        role: "creator",
      },
    ]);
  });
});

describe("getActiveOrgName — org-scoped read of the active org's name", () => {
  it("filters on organization.id = ctx.orgId and returns the name", async () => {
    const chain = makeSelectChain(select, [{ name: "Acme Agency" }]);

    const name = await getActiveOrgName(
      memberCtx({ orgId: "org_1", role: "admin", brandIds: "all" }),
    );

    const query = renderedWhere(chain);
    expect(query.sql).toContain('"organization"."id" = $1');
    expect(query.params).toEqual(["org_1"]);
    expect(name).toBe("Acme Agency");
  });

  it("returns null when the org row is missing (no cross-tenant leak)", async () => {
    makeSelectChain(select, []);

    const name = await getActiveOrgName(
      // A distinct org id so the memoized helper doesn't reuse the prior result.
      memberCtx({ orgId: "org_2", role: "owner", brandIds: "all" }),
    );

    expect(name).toBeNull();
  });
});

describe("listOrgIdsForSweep — the ONE intentional un-scoped read (D4 sweep)", () => {
  it("enumerates every org id with no org predicate (system-only, no ctx)", async () => {
    // Deliberately un-scoped: the cron orphan sweep has no org context and must
    // list all orgs, then run the ORDINARY org-scoped DAL per org (§6/§13).
    const chain = makeSelectChain(select, [{ id: "org_1" }, { id: "org_2" }]);

    const ids = await listOrgIdsForSweep();

    expect(select).toHaveBeenCalledOnce();
    // No where-clause: it is the documented exception, not a scoping bug.
    expect(chain.where).not.toHaveBeenCalled();
    expect(ids).toEqual(["org_1", "org_2"]);
  });
});
