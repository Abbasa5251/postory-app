import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { authAuditEventSchema } from "@/lib/validation/audit";
import {
  authRequestEvent,
  sessionCreatedEvent,
  userCreatedEvent,
} from "@/server/auth/auth-audit";

const headers = (extra: Record<string, string> = {}) =>
  new Headers({
    "user-agent": "vitest-agent",
    "x-forwarded-for": "203.0.113.7",
    ...extra,
  });

describe("sessionCreatedEvent", () => {
  it("maps the session row incl. active org onto a sign-in success event", () => {
    const event = sessionCreatedEvent({
      userId: "user_1",
      activeOrganizationId: "org_1",
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
    });
    expect(event).toEqual({
      action: "auth.sign_in.succeeded",
      userId: "user_1",
      orgId: "org_1",
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
    });
  });

  it("tolerates a session with no org (first sign-in before onboarding)", () => {
    const event = sessionCreatedEvent({ userId: "user_1" });
    expect(event.orgId).toBeNull();
  });
});

describe("userCreatedEvent", () => {
  it("captures ip (via better-auth header trust) and user-agent on sign-up", () => {
    const event = userCreatedEvent({ id: "user_2" }, headers(), {});
    expect(event.action).toBe("auth.sign_up");
    expect(event.userId).toBe("user_2");
    expect(event.ipAddress).toBe("203.0.113.7");
    expect(event.userAgent).toBe("vitest-agent");
  });
});

describe("authRequestEvent", () => {
  it("maps a failed email sign-in with lowercased attempted email, code, and status", () => {
    const event = authRequestEvent({
      path: "/sign-in/email",
      returned: new APIError("UNAUTHORIZED", {
        code: "INVALID_EMAIL_OR_PASSWORD",
      }),
      body: { email: "User@Example.COM", password: "hunter2-secret" },
      headers: headers(),
      options: {},
    });
    expect(event).not.toBeNull();
    expect(event!.action).toBe("auth.sign_in.failed");
    expect(event!.metadata).toMatchObject({
      email: "user@example.com",
      code: "INVALID_EMAIL_OR_PASSWORD",
      statusCode: 401,
    });
    expect(event!.ipAddress).toBe("203.0.113.7");
    // The password must never leak into the audit event.
    expect(JSON.stringify(event)).not.toContain("hunter2-secret");
  });

  it("returns null for a successful sign-in (audited via session.create.after)", () => {
    expect(
      authRequestEvent({
        path: "/sign-in/email",
        returned: { redirect: false, token: "t" },
        body: { email: "a@b.co" },
        headers: headers(),
        options: {},
      }),
    ).toBeNull();
  });

  it("returns null for paths that are not audited", () => {
    expect(
      authRequestEvent({
        path: "/get-session",
        returned: null,
        body: undefined,
        headers: headers(),
        options: {},
      }),
    ).toBeNull();
  });

  it("records a successful password-reset request with the attempted email", () => {
    const event = authRequestEvent({
      path: "/request-password-reset",
      returned: { status: true },
      body: { email: "Client@Agency.IO" },
      headers: headers(),
      options: {},
    });
    expect(event!.action).toBe("auth.password_reset.requested");
    expect(event!.metadata).toEqual({ email: "client@agency.io" });
  });

  it("does not record a failed (e.g. malformed) password-reset request", () => {
    expect(
      authRequestEvent({
        path: "/request-password-reset",
        returned: new APIError("BAD_REQUEST"),
        body: {},
        headers: headers(),
        options: {},
      }),
    ).toBeNull();
  });

  it("records a completed password reset WITHOUT any body data", () => {
    const event = authRequestEvent({
      path: "/reset-password",
      returned: { status: true },
      body: { newPassword: "brand-new-secret", token: "reset-token-value" },
      headers: headers(),
      options: {},
    });
    expect(event!.action).toBe("auth.password_reset.completed");
    expect(event!.metadata).toBeUndefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("brand-new-secret");
    expect(serialized).not.toContain("reset-token-value");
  });
});

describe("authAuditEventSchema", () => {
  it("truncates oversized attacker-controlled header values instead of rejecting", () => {
    const parsed = authAuditEventSchema.parse({
      action: "auth.sign_in.failed",
      ipAddress: "9".repeat(1000),
      userAgent: "x".repeat(10_000),
    });
    expect(parsed.ipAddress).toHaveLength(64);
    expect(parsed.userAgent).toHaveLength(512);
  });

  it("rejects unknown actions", () => {
    expect(() =>
      authAuditEventSchema.parse({ action: "auth.made_up" }),
    ).toThrow();
  });
});
