import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { roles } from "@/server/auth/permissions";

// Seed of the §7 role×permission matrix (the full DAL/action matrix incl.
// cross-org isolation lands with A8). Mirrors the manual curl matrix that
// passed 2026-07-15.
describe("role statements — single source of role truth", () => {
  it("declares exactly the UI role set", () => {
    expect(Object.keys(roles).sort()).toEqual(Object.keys(ROLE_LABELS).sort());
  });

  it("approver approves and schedules but cannot administer brands", () => {
    expect(roles.approver.authorize({ post: ["approve"] }).success).toBe(true);
    expect(roles.approver.authorize({ post: ["schedule"] }).success).toBe(true);
    expect(roles.approver.authorize({ brand: ["create"] }).success).toBe(false);
    expect(roles.approver.authorize({ brand: ["delete"] }).success).toBe(false);
  });

  it("creator drafts and generates but cannot approve, schedule, or manage accounts", () => {
    expect(roles.creator.authorize({ post: ["create"] }).success).toBe(true);
    expect(roles.creator.authorize({ ai: ["generate"] }).success).toBe(true);
    expect(roles.creator.authorize({ post: ["approve"] }).success).toBe(false);
    expect(roles.creator.authorize({ post: ["schedule"] }).success).toBe(false);
    expect(roles.creator.authorize({ account: ["connect"] }).success).toBe(
      false,
    );
  });

  it("owner and admin hold full app-level access", () => {
    for (const role of [roles.owner, roles.admin]) {
      expect(
        role.authorize({ brand: ["create", "update", "delete"] }).success,
      ).toBe(true);
      expect(
        role.authorize({ post: ["create", "approve", "schedule"] }).success,
      ).toBe(true);
      expect(
        role.authorize({ account: ["connect", "disconnect"] }).success,
      ).toBe(true);
    }
  });
});
