import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { assertAssignableRole } from "@/server/auth/permissions";

// A4 carry-over (ADR-011): better-auth's built-in "member" role passes the
// org plugin's own validation but maps to zero permissions in permissions.ts.
// assertAssignableRole is wired into the organizationHooks (invite create/
// accept, add member, update role) in auth.ts.
describe("assertAssignableRole — org role assignment guard", () => {
  it.each(["owner", "admin", "approver", "creator"])(
    "accepts the app role '%s'",
    (role) => {
      expect(() => assertAssignableRole(role)).not.toThrow();
    },
  );

  it("accepts comma-joined and array multi-role values of app roles", () => {
    expect(() => assertAssignableRole("approver,creator")).not.toThrow();
    expect(() => assertAssignableRole(["approver", "creator"])).not.toThrow();
  });

  it("rejects better-auth's built-in 'member' role", () => {
    expect(() => assertAssignableRole("member")).toThrow(APIError);
  });

  it("rejects 'member' hidden inside a multi-role string", () => {
    expect(() => assertAssignableRole("member,approver")).toThrow(APIError);
    expect(() => assertAssignableRole("approver, member")).toThrow(APIError);
  });

  it("rejects case variants and unknown roles (exact-match only)", () => {
    expect(() => assertAssignableRole("Member")).toThrow(APIError);
    expect(() => assertAssignableRole("OWNER")).toThrow(APIError);
    expect(() => assertAssignableRole("superuser")).toThrow(APIError);
  });

  it("throws a 400-shaped APIError (matches the plugin's own role validation)", () => {
    try {
      assertAssignableRole("member");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect((error as InstanceType<typeof APIError>).status).toBe(
        "BAD_REQUEST",
      );
      expect((error as InstanceType<typeof APIError>).statusCode).toBe(400);
    }
  });

  it("treats empty/absent role as a no-op (presence validation is the plugin's job)", () => {
    expect(() => assertAssignableRole(undefined)).not.toThrow();
    expect(() => assertAssignableRole(null)).not.toThrow();
    expect(() => assertAssignableRole("")).not.toThrow();
    expect(() => assertAssignableRole([])).not.toThrow();
  });
});
