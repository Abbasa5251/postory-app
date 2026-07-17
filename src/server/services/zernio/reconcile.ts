import "server-only";
import { isPlatform } from "@/lib/platforms/config";
import {
  insertSocialAccount,
  listSocialAccounts,
  syncSocialAccount,
} from "@/server/dal/accounts";
import type { AuthCtx } from "@/server/dal/types";
import { log } from "@/server/services/observability";
import { getAccountsHealth, listAccounts } from "./client";
import { healthToStatus, type AccountStatus } from "./schemas";

/**
 * Connect-flow SYNC step (B3, #29/#30) — the one place the Zernio client and
 * the accounts DAL meet. Orchestration, not pure wire: reads Zernio's account
 * state for a profile and reconciles our rows to it — inserting accounts we're
 * missing (self-heals a closed-tab drift; audits `account.connect`) and
 * refreshing existing ones' handle/avatar/status (audits `account.sync`).
 *
 * Status semantics differ by caller:
 *  - `mode: "connect"` (OAuth callback) — a just-completed OAuth means the
 *    reconnected `platform` is healthy, so only that platform's accounts become
 *    `connected`. Accounts of OTHER platforms keep their existing status — an
 *    Instagram reconnect must not flip a still-expired Facebook to `connected`.
 *  - `mode: "health"` (manual Refresh) — pull `GET /accounts/health` and apply
 *    it; an account ABSENT from the health response keeps its current status
 *    (never silently downgraded to `connected`), and a health-call failure is
 *    tolerated (log + leave statuses untouched) so an outage can't wipe state.
 */
export async function reconcileBrandAccounts(
  ctx: AuthCtx,
  brandId: string,
  profileId: string,
  opts: { mode: "connect"; platform: string } | { mode: "health" },
): Promise<void> {
  const zAccounts = await listAccounts(profileId);

  const statusByZid = new Map<string, AccountStatus>();
  if (opts.mode === "health") {
    try {
      for (const entry of await getAccountsHealth(profileId)) {
        statusByZid.set(entry._id, healthToStatus(entry));
      }
    } catch (error) {
      // Health is best-effort: an outage must not fail the whole refresh or
      // wipe known statuses. Leave statusByZid empty → existing rows preserved.
      log.warn("zernio account health fetch failed; skipping status refresh", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const existing = await listSocialAccounts(ctx, brandId);
  const existingStatus = new Map(
    existing.map((a) => [a.zernioAccountId, a.status as AccountStatus]),
  );

  for (const acct of zAccounts) {
    // We only manage the 6 launch platforms; ignore anything else Zernio might
    // return rather than tripping the DB platform CHECK (§9 boundary).
    if (!isPlatform(acct.platform)) continue;

    const isExisting = existingStatus.has(acct.zernioAccountId);
    let status: AccountStatus;
    if (opts.mode === "connect") {
      // Only the reconnected platform is proven healthy; others preserve their
      // existing status (a new account of another platform defaults connected).
      status =
        acct.platform === opts.platform
          ? "connected"
          : (existingStatus.get(acct.zernioAccountId) ?? "connected");
    } else {
      status =
        statusByZid.get(acct.zernioAccountId) ??
        existingStatus.get(acct.zernioAccountId) ??
        "connected";
    }

    if (isExisting) {
      await syncSocialAccount(ctx, brandId, {
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
