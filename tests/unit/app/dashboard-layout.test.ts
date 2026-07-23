import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-gate test for the (dashboard) layout. Boundary deps + UI are mocked;
 * `redirect` throws (as Next's does). Covers anonymous → sign-in, null active
 * org → recover/onboard, and an active org rendering without a redirect.
 */

const { ensureSession } = vi.hoisted(() => ({ ensureSession: vi.fn() }));
const { recoverActiveOrg } = vi.hoisted(() => ({ recoverActiveOrg: vi.fn() }));
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { getAuthCtx } = vi.hoisted(() => ({ getAuthCtx: vi.fn() }));
const { listBrands } = vi.hoisted(() => ({ listBrands: vi.fn() }));
const { getActiveOrgName } = vi.hoisted(() => ({
  getActiveOrgName: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@better-auth-ui/react/server", () => ({ ensureSession }));
vi.mock("@tanstack/react-query", () => ({
  HydrationBoundary: () => null,
  dehydrate: vi.fn(),
}));
vi.mock("@/lib/query-client", () => ({ getQueryClient: () => ({}) }));
vi.mock("@/server/auth/auth", () => ({ auth: {} }));
vi.mock("@/server/auth/active-org", () => ({ recoverActiveOrg }));
vi.mock("@/server/auth/context", () => ({ getAuthCtx }));
vi.mock("@/server/dal/brands", () => ({ listBrands }));
vi.mock("@/server/dal/org", () => ({ getActiveOrgName }));
vi.mock("@/server/dal/brand-members", () => ({
  listBrandIdsForMember: vi.fn(async () => []),
}));
vi.mock("@/server/dal/posts", () => ({
  countPendingReview: vi.fn(async () => 0),
}));
vi.mock("@/components/features/shell/app-sidebar", () => ({
  AppSidebar: () => null,
}));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: () => null,
  SidebarInset: () => null,
  SidebarTrigger: () => null,
}));

import DashboardLayout from "@/app/(dashboard)/layout";

const render = () => DashboardLayout({ children: null });
const member = (activeOrganizationId: string | null) => ({
  session: { activeOrganizationId },
  user: { id: "user_1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  // Shell data reads (only reached once the gate passes).
  getAuthCtx.mockResolvedValue({ orgId: "org_1", role: "owner" });
  listBrands.mockResolvedValue([]);
  getActiveOrgName.mockResolvedValue("Acme Agency");
});

describe("DashboardLayout gate", () => {
  it("redirects an anonymous visitor to sign-in", async () => {
    ensureSession.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("REDIRECT:/auth/sign-in");
  });

  it("recovers a null active org (with memberships) and redirects to the dashboard", async () => {
    ensureSession.mockResolvedValue(member(null));
    recoverActiveOrg.mockResolvedValue("recovered");
    await expect(render()).rejects.toThrow("REDIRECT:/dashboard");
    expect(recoverActiveOrg).toHaveBeenCalledWith(
      expect.any(Headers),
      "user_1",
    );
  });

  it("sends an org-less member to onboarding", async () => {
    ensureSession.mockResolvedValue(member(null));
    recoverActiveOrg.mockResolvedValue("none");
    await expect(render()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders (no redirect) when the session already has an active org", async () => {
    ensureSession.mockResolvedValue(member("org_1"));
    await render();
    expect(redirect).not.toHaveBeenCalled();
    expect(recoverActiveOrg).not.toHaveBeenCalled();
  });
});
