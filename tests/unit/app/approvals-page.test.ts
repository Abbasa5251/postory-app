import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direct-route authorization gate for the /approvals page (E2). The surface is
 * reviewer-only (post:approve = owner/admin/approver); a creator navigating
 * straight to the URL must be rejected BEFORE any queue/brand data is read —
 * client-side link-hiding is UX sugar, the server is the boundary (§7).
 *
 * Boundary deps are mocked; `getAuthCtx` supplies the role and `redirect`
 * throws (as Next's real one does) so control halts. The permission check
 * itself is NOT mocked — the real `can`/`permissions.ts` role truth runs.
 */

const { getAuthCtx } = vi.hoisted(() => ({ getAuthCtx: vi.fn() }));
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
const { listPostsForReview } = vi.hoisted(() => ({
  listPostsForReview: vi.fn(),
}));
const { listBrandIdsForMember } = vi.hoisted(() => ({
  listBrandIdsForMember: vi.fn(),
}));
const { listBrands } = vi.hoisted(() => ({ listBrands: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/server/auth/context", () => ({ getAuthCtx }));
vi.mock("@/server/dal/posts", () => ({ listPostsForReview }));
vi.mock("@/server/dal/brand-members", () => ({ listBrandIdsForMember }));
vi.mock("@/server/dal/brands", () => ({ listBrands }));
vi.mock("@/server/dal/accounts", () => ({
  listSocialAccountsForBrands: vi.fn(async () => []),
}));
vi.mock("@/server/dal/media", () => ({ getMediaByIds: vi.fn(async () => []) }));
vi.mock("@/server/media-views", () => ({ toMediaAssetView: vi.fn() }));
vi.mock("@/components/features/approvals/search-params", () => ({
  loadApprovalFilters: vi.fn(async () => ({ workspace: null, platform: null })),
}));
vi.mock("@/components/features/approvals/review-queue", () => ({
  ReviewQueue: () => null,
}));
vi.mock("@/components/features/approvals/approvals-filters", () => ({
  ApprovalsFilters: () => null,
}));

import ApprovalsPage from "@/app/(dashboard)/approvals/page";

const ctx = (role: "creator" | "approver") => ({
  orgId: "org_1",
  memberId: "member_1",
  role,
  brandIds: role === "creator" ? [] : "all",
});

const searchParams = Promise.resolve({});

beforeEach(() => {
  vi.clearAllMocks();
  listBrandIdsForMember.mockResolvedValue([]);
  listBrands.mockResolvedValue([]);
  listPostsForReview.mockResolvedValue([]);
});

describe("ApprovalsPage — reviewer-only route gate (§7)", () => {
  it("redirects a creator (no post:approve) to the dashboard before loading the queue", async () => {
    getAuthCtx.mockResolvedValue(ctx("creator"));
    await expect(ApprovalsPage({ searchParams })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
    // The gate runs before ANY queue or brand read.
    expect(listPostsForReview).not.toHaveBeenCalled();
    expect(listBrandIdsForMember).not.toHaveBeenCalled();
    expect(listBrands).not.toHaveBeenCalled();
  });

  it("lets an approver through to load the queue", async () => {
    getAuthCtx.mockResolvedValue(ctx("approver"));
    const result = await ApprovalsPage({ searchParams });
    expect(redirect).not.toHaveBeenCalled();
    expect(listPostsForReview).toHaveBeenCalledOnce();
    expect(result).toBeTruthy();
  });
});
