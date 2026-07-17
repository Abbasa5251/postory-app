import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverActiveOrg } from "@/server/auth/active-org";

/**
 * recoverActiveOrg (dashboard/onboarding gate recovery). The better-auth
 * adapter (via auth.$context) and setActiveOrganization are mocked, so we assert
 * the recovery decision + that the selected org is set active — exercising the
 * real selectInitialOrganizationId over the mocked adapter.
 */

const { findMany, setActiveOrganization } = vi.hoisted(() => ({
  findMany: vi.fn(),
  setActiveOrganization: vi.fn(),
}));
vi.mock("@/server/auth/auth", () => ({
  auth: {
    $context: Promise.resolve({ adapter: { findMany } }),
    api: { setActiveOrganization },
  },
}));

const headers = new Headers();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recoverActiveOrg", () => {
  it("recovers by setting the user's earliest-membership org active", async () => {
    findMany.mockResolvedValue([{ organizationId: "o1" }]);

    const result = await recoverActiveOrg(headers, "user_1");

    expect(result).toBe("recovered");
    expect(setActiveOrganization).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "o1" },
    });
    // earliest-membership query (member table, createdAt asc, limit 1).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "member",
        where: [{ field: "userId", value: "user_1" }],
        sortBy: { field: "createdAt", direction: "asc" },
        limit: 1,
      }),
    );
  });

  it("returns 'none' and sets nothing when the user has no memberships", async () => {
    findMany.mockResolvedValue([]);

    expect(await recoverActiveOrg(headers, "user_1")).toBe("none");
    expect(setActiveOrganization).not.toHaveBeenCalled();
  });
});
