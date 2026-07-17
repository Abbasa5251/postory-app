"use server";

import { revalidatePath } from "next/cache";
import {
  disconnectAccountSchema,
  refreshAccountsSchema,
} from "@/lib/validation/accounts";
import {
  deleteSocialAccountById,
  getSocialAccountById,
  getZernioProfileByBrand,
} from "@/server/dal/accounts";
import { getBrandById } from "@/server/dal/brands";
import { disconnectAccount as zernioDisconnect } from "@/server/services/zernio";
import { reconcileBrandAccounts } from "@/server/services/zernio/reconcile";
import { withAction } from "./with-action";

/**
 * Social-account server actions (B3). Authored through `withAction` (ADR-013 /
 * §7). The interactive connect/callback live in route handlers (ADR-014); these
 * are the non-interactive mutations.
 */

/**
 * Refresh a brand's connected accounts against Zernio (#30): self-heals drift
 * (accounts connected but not yet persisted) and pulls health to flip
 * connected ⇄ needs_reauth. Manual (a button) rather than on every page render,
 * so RSC render stays side-effect-free.
 */
export const refreshBrandAccounts = withAction(
  refreshAccountsSchema,
  "account:connect",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch: cross-org / unassigned 404 before any work.
    await getBrandById(ctx, data.brandId);
    const profile = await getZernioProfileByBrand(ctx, data.brandId);
    // No profile → the brand has never connected an account; nothing to sync.
    if (profile) {
      await reconcileBrandAccounts(ctx, data.brandId, profile.zernioProfileId, {
        withHealth: true,
      });
    }
    revalidatePath(`/brands/${data.brandId}/accounts`);
    return { brandId: data.brandId };
  },
);

/**
 * Disconnect a connected account (#31): stops Zernio account-day billing, then
 * hard-deletes our row (ADR-009 re-amended — no `disconnected` status;
 * reconnecting re-runs the connect flow). ADR-010's trial auto-disconnect (H1)
 * reuses this same service + DAL pair.
 */
export const disconnectAccount = withAction(
  disconnectAccountSchema,
  "account:disconnect",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch: 404 before any external call; also yields the
    // zernio_account_id we must disconnect.
    const account = await getSocialAccountById(
      ctx,
      data.brandId,
      data.accountId,
    );
    // Stop the Zernio meter first (idempotent; a 404 there is swallowed), then
    // remove our row + audit.
    await zernioDisconnect(account.zernioAccountId);
    await deleteSocialAccountById(ctx, data.accountId);
    revalidatePath(`/brands/${data.brandId}/accounts`);
    return { accountId: data.accountId };
  },
);
