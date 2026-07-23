import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllowSelfApproval } from "@/server/dal/org-settings";
import { memberCtx } from "../helpers/ctx";
import { makeSelectChain, renderedWhere } from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the org-settings DAL (E1). The self-approval
 * read is org-scoped (org_id = ctx.orgId) and fails safe to `false` when no row
 * exists, so absent config can never let a reviewer self-approve.
 */

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db/db", () => ({ db: { select } }));

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = memberCtx({ role: "admin", brandIds: "all" });

describe("getAllowSelfApproval", () => {
  it("scopes the read to org_id = ctx.orgId", async () => {
    const chain = makeSelectChain(select, [{ allowSelfApproval: true }]);
    const result = await getAllowSelfApproval(ctx);
    expect(result).toBe(true);
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
  });

  it("fails safe to false when the org has no settings row", async () => {
    makeSelectChain(select, []);
    expect(await getAllowSelfApproval(ctx)).toBe(false);
  });
});
