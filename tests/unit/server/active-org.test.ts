import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverActiveOrg } from "@/server/auth/active-org";

/**
 * recoverActiveOrg (dashboard/onboarding gate recovery). auth.api is mocked so
 * we assert the recovery decision + that the EARLIEST org is set active,
 * without loading the real better-auth instance.
 */

const { listOrganizations, setActiveOrganization } = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  setActiveOrganization: vi.fn(),
}));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: { listOrganizations, setActiveOrganization } },
}));

const headers = new Headers();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recoverActiveOrg", () => {
  it("recovers by setting the user's earliest org active", async () => {
    listOrganizations.mockResolvedValue([
      { id: "o2", createdAt: "2026-02-01T00:00:00Z" },
      { id: "o1", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    const result = await recoverActiveOrg(headers);

    expect(result).toBe("recovered");
    expect(setActiveOrganization).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "o1" }, // earliest by createdAt
    });
  });

  it("returns 'none' and sets nothing when the user has no orgs", async () => {
    listOrganizations.mockResolvedValue([]);

    expect(await recoverActiveOrg(headers)).toBe("none");
    expect(setActiveOrganization).not.toHaveBeenCalled();
  });

  it("returns 'none' when listOrganizations yields null/undefined", async () => {
    listOrganizations.mockResolvedValue(null);

    expect(await recoverActiveOrg(headers)).toBe("none");
    expect(setActiveOrganization).not.toHaveBeenCalled();
  });
});
