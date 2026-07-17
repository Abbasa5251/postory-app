import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberCtx } from "../../helpers/ctx";

/**
 * reconcileBrandAccounts (#30) — status semantics. The Zernio client and the
 * accounts DAL are mocked so we assert the STATUS the reconcile decides per
 * account, independent of HTTP/DB. Regression focus: a per-platform reconnect
 * must not flip a still-expired account of a DIFFERENT platform to connected.
 */

const { listAccounts, getAccountsHealth } = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccountsHealth: vi.fn(),
}));
vi.mock("@/server/services/zernio/client", () => ({
  listAccounts,
  getAccountsHealth,
}));

const { listSocialAccounts, insertSocialAccount, syncSocialAccount } =
  vi.hoisted(() => ({
    listSocialAccounts: vi.fn(),
    insertSocialAccount: vi.fn(),
    syncSocialAccount: vi.fn(),
  }));
vi.mock("@/server/dal/accounts", () => ({
  listSocialAccounts,
  insertSocialAccount,
  syncSocialAccount,
}));

import { reconcileBrandAccounts } from "@/server/services/zernio/reconcile";

const ctx = memberCtx({ role: "admin", brandIds: "all" });

/** status each account was synced/inserted with, keyed by zernio account id. */
function statusByZid() {
  const out: Record<string, string> = {};
  for (const [, , input] of syncSocialAccount.mock.calls)
    out[input.zernioAccountId] = input.status;
  for (const [, input] of insertSocialAccount.mock.calls)
    out[input.zernioAccountId] = input.status;
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  syncSocialAccount.mockResolvedValue(true);
  insertSocialAccount.mockResolvedValue({ id: "sa" });
});

describe("reconcile — connect mode is scoped to the reconnected platform", () => {
  it("reconnecting instagram leaves an expired facebook expired", async () => {
    listAccounts.mockResolvedValue([
      {
        zernioAccountId: "ig1",
        platform: "instagram",
        handle: "@ig",
        avatarUrl: null,
      },
      {
        zernioAccountId: "fb1",
        platform: "facebook",
        handle: "fb",
        avatarUrl: null,
      },
    ]);
    listSocialAccounts.mockResolvedValue([
      { zernioAccountId: "ig1", status: "needs_reauth" },
      { zernioAccountId: "fb1", status: "needs_reauth" },
    ]);

    await reconcileBrandAccounts(ctx, "brand_1", "prof_1", {
      mode: "connect",
      platform: "instagram",
    });

    const byZid = statusByZid();
    expect(byZid.ig1).toBe("connected"); // the reconnected platform
    expect(byZid.fb1).toBe("needs_reauth"); // untouched — preserved
    expect(getAccountsHealth).not.toHaveBeenCalled(); // connect mode: no health pull
  });
});

describe("reconcile — health mode", () => {
  it("applies health where present and preserves status where absent", async () => {
    listAccounts.mockResolvedValue([
      {
        zernioAccountId: "ig1",
        platform: "instagram",
        handle: "@ig",
        avatarUrl: null,
      },
      {
        zernioAccountId: "fb1",
        platform: "facebook",
        handle: "fb",
        avatarUrl: null,
      },
    ]);
    listSocialAccounts.mockResolvedValue([
      { zernioAccountId: "ig1", status: "connected" },
      { zernioAccountId: "fb1", status: "connected" },
    ]);
    // Health reports ig1 unpostable; fb1 absent from the response.
    getAccountsHealth.mockResolvedValue([{ _id: "ig1", canPost: false }]);

    await reconcileBrandAccounts(ctx, "brand_1", "prof_1", { mode: "health" });

    const byZid = statusByZid();
    expect(byZid.ig1).toBe("needs_reauth"); // health said so
    expect(byZid.fb1).toBe("connected"); // absent from health → preserved
  });

  it("tolerates a health-fetch failure without wiping statuses", async () => {
    listAccounts.mockResolvedValue([
      {
        zernioAccountId: "ig1",
        platform: "instagram",
        handle: "@ig",
        avatarUrl: null,
      },
    ]);
    listSocialAccounts.mockResolvedValue([
      { zernioAccountId: "ig1", status: "needs_reauth" },
    ]);
    getAccountsHealth.mockRejectedValue(new Error("health down"));

    await reconcileBrandAccounts(ctx, "brand_1", "prof_1", { mode: "health" });

    expect(statusByZid().ig1).toBe("needs_reauth"); // preserved through the outage
  });
});
