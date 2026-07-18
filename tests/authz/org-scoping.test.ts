import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOrgMembers } from "@/server/dal/org";
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
