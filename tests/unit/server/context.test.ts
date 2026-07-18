import { beforeEach, describe, expect, it, vi } from "vitest";

// context.ts statically imports next/headers, the better-auth instance, and
// (B5.2) the creator-brand resolver. getSystemCtx touches none of them, so all
// three are stubbed; getAuthCtx drives them through the hoisted spies.
const { headers, getSession, getActiveMember } = vi.hoisted(() => ({
  headers: vi.fn(),
  getSession: vi.fn(),
  getActiveMember: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: { getSession, getActiveMember } },
}));

// Seam B: the DAL resolver is mocked so this stays a pure ctx-construction
// unit — mirrors the authz suite's vi.mock("@/db/db", …) style. The assertion
// that it is NEVER called for non-creators is the short-circuit proof (§6.5).
const { resolveCreatorBrandIds } = vi.hoisted(() => ({
  resolveCreatorBrandIds: vi.fn(),
}));
vi.mock("@/server/dal/brand-members", () => ({ resolveCreatorBrandIds }));

import {
  getAuthCtx,
  getSystemCtx,
  UnauthorizedError,
} from "@/server/auth/context";

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers());
});

describe("getSystemCtx", () => {
  it("builds a system ctx with full brand access and job attribution", () => {
    const ctx = getSystemCtx("org_1", "generation/image.requested");
    expect(ctx).toEqual({
      orgId: "org_1",
      role: "system",
      brandIds: "all",
      jobName: "generation/image.requested",
    });
  });
});

describe("getAuthCtx — creator brand-scope resolution (B5.2)", () => {
  it("resolves a creator's brandIds fresh from brand_members", async () => {
    getSession.mockResolvedValue({
      session: { activeOrganizationId: "org_1" },
    });
    getActiveMember.mockResolvedValue({ id: "member_1", role: "creator" });
    resolveCreatorBrandIds.mockResolvedValue(["b1", "b2"]);

    const ctx = await getAuthCtx();

    expect(ctx).toEqual({
      orgId: "org_1",
      memberId: "member_1",
      role: "creator",
      brandIds: ["b1", "b2"],
    });
    // org id is session-derived, member id from the active membership.
    expect(resolveCreatorBrandIds).toHaveBeenCalledWith("org_1", "member_1");
  });

  it("a creator with no assignments gets an empty brandIds list (→ sees nothing)", async () => {
    getSession.mockResolvedValue({
      session: { activeOrganizationId: "org_1" },
    });
    getActiveMember.mockResolvedValue({ id: "member_1", role: "creator" });
    resolveCreatorBrandIds.mockResolvedValue([]);

    const ctx = await getAuthCtx();

    expect(ctx.brandIds).toEqual([]);
    expect(resolveCreatorBrandIds).toHaveBeenCalledOnce();
  });

  it.each(["owner", "admin", "approver"] as const)(
    "%s short-circuits to 'all' and never calls the resolver",
    async (role) => {
      getSession.mockResolvedValue({
        session: { activeOrganizationId: "org_1" },
      });
      getActiveMember.mockResolvedValue({ id: "member_1", role });

      const ctx = await getAuthCtx();

      expect(ctx.brandIds).toBe("all");
      expect(resolveCreatorBrandIds).not.toHaveBeenCalled();
    },
  );

  it("throws UnauthorizedError when there is no active organization", async () => {
    getSession.mockResolvedValue({ session: { activeOrganizationId: null } });

    await expect(getAuthCtx()).rejects.toThrow(UnauthorizedError);
    expect(resolveCreatorBrandIds).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when the session has no active membership", async () => {
    getSession.mockResolvedValue({
      session: { activeOrganizationId: "org_1" },
    });
    getActiveMember.mockResolvedValue(null);

    await expect(getAuthCtx()).rejects.toThrow(UnauthorizedError);
    expect(resolveCreatorBrandIds).not.toHaveBeenCalled();
  });
});
