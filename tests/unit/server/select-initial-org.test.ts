import { describe, expect, it, vi } from "vitest";
import { selectInitialOrganizationId } from "@/server/auth/select-initial-org";

/**
 * The shared default-active-org policy (earliest membership). The better-auth
 * adapter is mocked; we assert the query shape + selection so sign-in and gate
 * recovery, both of which call this, stay in lockstep.
 */

type Adapter = Parameters<typeof selectInitialOrganizationId>[0];

describe("selectInitialOrganizationId", () => {
  it("queries the member table (createdAt asc, limit 1) and returns the org id", async () => {
    const findMany = vi.fn().mockResolvedValue([{ organizationId: "o1" }]);
    const adapter = { findMany } as Adapter;

    const result = await selectInitialOrganizationId(adapter, "user_1");

    expect(result).toBe("o1");
    expect(findMany).toHaveBeenCalledWith({
      model: "member",
      where: [{ field: "userId", value: "user_1" }],
      sortBy: { field: "createdAt", direction: "asc" },
      limit: 1,
    });
  });

  it("returns null when the user has no memberships", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const adapter = { findMany } as Adapter;

    expect(await selectInitialOrganizationId(adapter, "user_1")).toBeNull();
  });
});
