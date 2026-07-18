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
  it("maps _id/platform/username and the profilePicture avatar", () => {
    expect(
      normalizeAccount({
        _id: "a1",
        platform: "instagram",
        username: "@acme",
        profilePicture: "https://img/acme.png",
      }),
    ).toEqual({
      zernioAccountId: "a1",
      platform: "instagram",
      handle: "@acme",
      avatarUrl: "https://img/acme.png",
    });
  });

  it("resolves the handle username → displayName → _id", () => {
    // username wins over displayName and _id.
    expect(
      normalizeAccount({
        _id: "a1",
        platform: "x",
        username: "U",
        displayName: "D",
      }).handle,
    ).toBe("U");
    // displayName wins over _id.
    expect(
      normalizeAccount({ _id: "a1", platform: "x", displayName: "D" }).handle,
    ).toBe("D");
    expect(normalizeAccount({ _id: "a1", platform: "x" }).handle).toBe("a1");
  });

  it("reads the avatar from profilePicture (the confirmed field), null when absent", () => {
    // Regression: the pre-fix code looked for picture/avatar/avatarUrl and
    // never `profilePicture`, so every avatar came back null (blank initials).
    expect(
      normalizeAccount({
        _id: "a1",
        platform: "x",
        profilePicture: "https://img/p.png",
      }).avatarUrl,
    ).toBe("https://img/p.png");
    expect(normalizeAccount({ _id: "a1", platform: "x" }).avatarUrl).toBe(null);
    // The spec allows an explicit null profilePicture.
    expect(
      normalizeAccount({ _id: "a1", platform: "x", profilePicture: null })
        .avatarUrl,
    ).toBe(null);
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
