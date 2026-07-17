import "server-only";
import {
  insertSocialAccount,
  listSocialAccounts,
  syncSocialAccount,
} from "@/server/dal/accounts";
import type { AuthCtx } from "@/server/dal/types";
import { getAccountsHealth, listAccounts } from "./client";
import { healthToStatus, type AccountStatus } from "./schemas";

/**
 * Connect-flow SYNC step (B3, #29/#30) — the one place the Zernio client and
 * the accounts DAL meet. Orchestration, not pure wire: reads Zernio's account
 * state for a profile and reconciles our rows to it — inserting accounts we're
 * missing (self-heals a closed-tab drift; audits `account.connect`) and
 * refreshing existing ones' handle/avatar/status (audits `account.sync`).
 *
 * Called by the OAuth callback (`withHealth: false` — a successful connect
 * means healthy, so everything is `connected`) and the manual Refresh action
 * (`withHealth: true` — pulls `GET /accounts/health` to detect `needs_reauth`).
 * All caller-side tenancy comes from `ctx`; the DAL calls stay org-scoped.
 */
export async function reconcileBrandAccounts(
  ctx: AuthCtx,
  brandId: string,
  profileId: string,
  opts: { withHealth: boolean },
): Promise<void> {
  const zAccounts = await listAccounts(profileId);

  const statusByZid = new Map<string, AccountStatus>();
  if (opts.withHealth) {
    for (const entry of await getAccountsHealth(profileId)) {
      statusByZid.set(entry._id, healthToStatus(entry));
    }
  }

  const existing = await listSocialAccounts(ctx, brandId);
  const existingZids = new Set(existing.map((a) => a.zernioAccountId));

  for (const acct of zAccounts) {
    const status = statusByZid.get(acct.zernioAccountId) ?? "connected";
    if (existingZids.has(acct.zernioAccountId)) {
      await syncSocialAccount(ctx, {
        zernioAccountId: acct.zernioAccountId,
        handle: acct.handle,
        avatarUrl: acct.avatarUrl,
        status,
      });
    } else {
      await insertSocialAccount(ctx, {
        brandId,
        zernioProfileId: profileId,
        platform: acct.platform,
        zernioAccountId: acct.zernioAccountId,
        handle: acct.handle,
        avatarUrl: acct.avatarUrl,
        status,
      });
    }
  }
}
