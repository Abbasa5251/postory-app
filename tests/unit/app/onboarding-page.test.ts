import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-gate test for the onboarding page (recovery wiring). All boundary deps
 * are mocked; `redirect` throws (as Next's real one does) so control halts, and
 * we assert which destination each session state resolves to.
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
const { recoverActiveOrg } = vi.hoisted(() => ({ recoverActiveOrg: vi.fn() }));
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/server/auth/active-org", () => ({ recoverActiveOrg }));
vi.mock("@/components/features/onboarding/onboarding-card", () => ({
  OnboardingCard: () => null,
}));

import OnboardingPage from "@/app/(auth)/onboarding/page";

const member = (activeOrganizationId: string | null) => ({
  session: { activeOrganizationId },
  user: { id: "user_1", name: "Ada" },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnboardingPage gate", () => {
  it("redirects an anonymous visitor to sign-in", async () => {
    getSession.mockResolvedValue(null);
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/auth/sign-in");
  });

  it("redirects a member who already has an active org to the dashboard", async () => {
    getSession.mockResolvedValue(member("org_1"));
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(recoverActiveOrg).not.toHaveBeenCalled();
  });

  it("recovers a null active org (with memberships) and redirects to the dashboard", async () => {
    getSession.mockResolvedValue(member(null));
    recoverActiveOrg.mockResolvedValue("recovered");
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(recoverActiveOrg).toHaveBeenCalledWith(
      expect.any(Headers),
      "user_1",
    );
  });

  it("renders onboarding for a user who belongs to no org", async () => {
    getSession.mockResolvedValue(member(null));
    recoverActiveOrg.mockResolvedValue("none");
    const result = await OnboardingPage();
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
