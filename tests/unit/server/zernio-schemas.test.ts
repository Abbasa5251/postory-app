import { describe, expect, it } from "vitest";
import {
  accountsResponseSchema,
  healthToStatus,
  normalizeAccount,
  profileCreateResponseSchema,
  zernioAccountSchema,
} from "@/server/services/zernio/schemas";

/**
 * Seam B (pure/validation): Zernio response parsing + normalization. External
 * responses are parsed at the boundary (AGENTS.md §9); these prove our handling
 * of the documented shape and our defensive picking of the undocumented fields.
 */
describe("Zernio response schemas", () => {
  it("parses a profile-create response and requires _id", () => {
    expect(
      profileCreateResponseSchema.parse({
        profile: { _id: "abc", name: "Acme" },
      }).profile._id,
    ).toBe("abc");
    expect(
      profileCreateResponseSchema.safeParse({ profile: { name: "no id" } })
        .success,
    ).toBe(false);
  });

  it("rejects an account missing the documented required fields", () => {
    expect(zernioAccountSchema.safeParse({ _id: "a1" }).success).toBe(false); // no platform
    expect(
      zernioAccountSchema.safeParse({ platform: "instagram" }).success,
    ).toBe(false); // no _id
  });

  it("accepts and passes through unexpected account fields", () => {
    const parsed = accountsResponseSchema.parse({
      accounts: [{ _id: "a1", platform: "instagram", somethingNew: 1 }],
    });
    expect(parsed.accounts[0]._id).toBe("a1");
  });
});

describe("normalizeAccount", () => {
  it("maps _id/platform and picks the first available display field", () => {
    expect(
      normalizeAccount({ _id: "a1", platform: "instagram", username: "@acme" }),
    ).toEqual({
      zernioAccountId: "a1",
      platform: "instagram",
      handle: "@acme",
      avatarUrl: null,
    });
  });

  it("falls back through handle → displayName → name → _id, and picks an avatar", () => {
    expect(
      normalizeAccount({ _id: "a1", platform: "x", name: "Acme" }).handle,
    ).toBe("Acme");
    expect(normalizeAccount({ _id: "a1", platform: "x" }).handle).toBe("a1");
    expect(
      normalizeAccount({ _id: "a1", platform: "x", picture: "http://img" })
        .avatarUrl,
    ).toBe("http://img");
  });
});

describe("healthToStatus", () => {
  it("maps a not-postable account to needs_reauth", () => {
    expect(healthToStatus({ _id: "a1", canPost: false })).toBe("needs_reauth");
  });

  it("maps a disconnected/expired status string to needs_reauth", () => {
    expect(healthToStatus({ _id: "a1", status: "disconnected" })).toBe(
      "needs_reauth",
    );
    expect(healthToStatus({ _id: "a1", status: "EXPIRED" })).toBe(
      "needs_reauth",
    );
  });

  it("classifies only a positive signal as connected", () => {
    expect(healthToStatus({ _id: "a1", canPost: true })).toBe("connected");
    expect(healthToStatus({ _id: "a1", status: "active" })).toBe("connected");
  });

  it("treats unknown/absent signals as needs_reauth (conservative)", () => {
    expect(healthToStatus({ _id: "a1" })).toBe("needs_reauth");
    expect(healthToStatus({ _id: "a1", status: "mystery" })).toBe(
      "needs_reauth",
    );
  });
});
