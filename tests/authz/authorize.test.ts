import { describe, expect, it } from "vitest";
import { authorize } from "@/server/auth/authorize";
import { ForbiddenError } from "@/server/domain/errors";
import { memberCtx, systemCtx } from "../helpers/ctx";

/**
 * A6·1 — the coarse permission gate `authorize(ctx, "resource:action")` the §7
 * action template calls. The exhaustive role×permission truth table lives in
 * role-matrix.test.ts (asserted against the spec); this file proves the GATE's
 * behaviour on top of it: allow → returns void, deny → throws ForbiddenError,
 * system ctx → bypass. Representative cells only — the matrix owns full coverage.
 */
describe("authorize() — the §7 coarse permission gate", () => {
  it("returns void (no throw) when the role holds the permission", () => {
    expect(() =>
      authorize(memberCtx({ role: "approver" }), "post:approve"),
    ).not.toThrow();
    expect(
      authorize(memberCtx({ role: "creator" }), "post:create"),
    ).toBeUndefined();
  });

  it("throws ForbiddenError when the role lacks the permission", () => {
    expect(() =>
      authorize(memberCtx({ role: "creator" }), "post:approve"),
    ).toThrow(ForbiddenError);
    expect(() =>
      authorize(memberCtx({ role: "approver" }), "brand:create"),
    ).toThrow(ForbiddenError);
  });

  it("routes to the caller's own role (owner administers the org, admin cannot delete it)", () => {
    expect(() =>
      authorize(memberCtx({ role: "owner" }), "organization:delete"),
    ).not.toThrow();
    expect(() =>
      authorize(memberCtx({ role: "admin" }), "organization:delete"),
    ).toThrow(ForbiddenError);
  });

  it("grants a system (background-job) ctx every permission — jobs are trusted (§6.7)", () => {
    expect(() => authorize(systemCtx(), "brand:delete")).not.toThrow();
    expect(() => authorize(systemCtx(), "post:approve")).not.toThrow();
    expect(() => authorize(systemCtx(), "organization:delete")).not.toThrow();
  });
});
