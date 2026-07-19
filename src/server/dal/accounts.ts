import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { socialAccounts, zernioProfiles } from "@/db/schemas/brands";
import { NotFoundError } from "@/server/domain/errors";
import type { AccountStatus } from "@/server/services/zernio/schemas";
import { buildAuditInsert, recordAuditEvent } from "./audit";
import { assertBrandAccess, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Social accounts + Zernio profiles DAL (B3). Org-scoped like dal/brands.ts:
 * ctx first, orgScope in every query, brand access asserted, cross-org reads
 * 404-shaped. The interactive OAuth handlers call these after the Zernio
 * service call (ADR-014); the DAL itself never touches Zernio (§6).
 *
 * TODO(B4): connected-account entitlement/plan cap (trial: 3 accounts, plan
 * caps) — owned by entitlements.ts (not built yet). insertSocialAccount enforces
 * WHO (the action's account:connect gate) but not HOW MANY, mirroring the
 * createBrand TODO(B4) seam.
 */

/** All connected accounts for a brand: org-scoped, brand-access-checked. */
export async function listSocialAccounts(ctx: AuthCtx, brandId: string) {
  assertBrandAccess(ctx, brandId);
  return db
    .select()
    .from(socialAccounts)
    .where(
      and(orgScope(ctx, socialAccounts), eq(socialAccounts.brandId, brandId)),
    )
    .orderBy(socialAccounts.platform);
}

/**
 * One connected account by id, org + brand scoped. Throws NotFoundError for
 * nonexistent, cross-org, and unassigned-to-creator alike (§7 same 404 shape).
 * The disconnect action uses it as the §7 step-4 scoped fetch (and to read the
 * zernio_account_id it must disconnect at Zernio).
 */
export async function getSocialAccountById(
  ctx: AuthCtx,
  brandId: string,
  accountId: string,
) {
  assertBrandAccess(ctx, brandId);
  const [row] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        orgScope(ctx, socialAccounts),
        eq(socialAccounts.brandId, brandId),
        eq(socialAccounts.id, accountId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("account", accountId);
  return row;
}

/** The brand's single Zernio profile row, or undefined (ADR-009: 1:1, lazy). */
export async function getZernioProfileByBrand(ctx: AuthCtx, brandId: string) {
  assertBrandAccess(ctx, brandId);
  const [row] = await db
    .select()
    .from(zernioProfiles)
    .where(
      and(orgScope(ctx, zernioProfiles), eq(zernioProfiles.brandId, brandId)),
    )
    .limit(1);
  return row;
}

/**
 * Persist a lazily-provisioned Zernio profile (ADR-009). The Zernio
 * `POST /profiles` call happens in the handler (§6: DAL is DB-only); this
 * records the returned external id. Concurrent first-connects are safe: the
 * `(brand_id)` unique lets one row win; the loser gets no returned row
 * (onConflictDoNothing), re-reads the winner's profile, and reuses it — so at
 * most one profile persists and only the actual provisioner audits.
 */
export async function createZernioProfile(
  ctx: AuthCtx,
  brandId: string,
  zernioProfileId: string,
) {
  assertBrandAccess(ctx, brandId);
  const [row] = await db
    .insert(zernioProfiles)
    .values({ orgId: ctx.orgId, brandId, zernioProfileId })
    // Concurrent first-connects race here; the (brand_id) unique lets only one
    // row persist (§7 I2). onConflictDoNothing turns the loser into an empty
    // result instead of a throw.
    .onConflictDoNothing({ target: zernioProfiles.brandId })
    .returning();
  if (row) {
    await recordAuditEvent(ctx, {
      action: "zernio_profile.provision",
      entityType: "zernio_profile",
      entityId: row.id,
    });
    return row;
  }
  // Lost the race: the brand already has a profile (the winner's, org+brand
  // scoped). Reuse it — no audit, this request did not provision it.
  const existing = await getZernioProfileByBrand(ctx, brandId);
  if (!existing) {
    throw new Error(
      "zernio_profile insert conflicted but no existing row found",
    );
  }
  return existing;
}

export type InsertSocialAccountInput = {
  brandId: string;
  zernioProfileId: string;
  platform: string;
  zernioAccountId: string;
  handle: string;
  avatarUrl: string | null;
  status: AccountStatus;
};

/**
 * Insert a newly-connected account, idempotent by `zernio_account_id`
 * (§7 I2 — a double callback or retry inserts nothing the second time).
 * Returns the row on a real insert (and audits `account.connect`), or null if
 * the account already existed (no-op, no audit). Refreshing an existing
 * account's handle/avatar/status is a separate concern (#30 reconcile).
 */
export async function insertSocialAccount(
  ctx: AuthCtx,
  input: InsertSocialAccountInput,
) {
  assertBrandAccess(ctx, input.brandId);
  const [row] = await db
    .insert(socialAccounts)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId,
      zernioProfileId: input.zernioProfileId,
      platform: input.platform,
      zernioAccountId: input.zernioAccountId,
      handle: input.handle,
      avatarUrl: input.avatarUrl,
      status: input.status,
      connectedBy: ctx.role === "system" ? null : ctx.memberId,
    })
    .onConflictDoNothing({ target: socialAccounts.zernioAccountId })
    .returning();
  if (!row) return null; // already connected — idempotent no-op
  await recordAuditEvent(ctx, {
    action: "account.connect",
    entityType: "social_account",
    entityId: row.id,
    metadata: { platform: input.platform },
  });
  return row;
}

/**
 * Refresh an already-connected account's handle/avatar/status from a Zernio
 * sync (reconnect or the manual Refresh, #30). Org-scoped by
 * (org_id, zernio_account_id) so it can only ever touch the caller's own
 * account. Case A (dal/audit.ts): id known (the external zernio_account_id),
 * update + audit run in one interactive transaction. The sync is audited
 * unconditionally (even on a 0-row match), so both statements always run — no
 * early return inside the tx. Returns whether a row was updated.
 */
export async function syncSocialAccount(
  ctx: AuthCtx,
  brandId: string,
  input: {
    zernioAccountId: string;
    handle: string;
    avatarUrl: string | null;
    status: AccountStatus;
  },
) {
  assertBrandAccess(ctx, brandId);
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(socialAccounts)
      .set({
        handle: input.handle,
        avatarUrl: input.avatarUrl,
        status: input.status,
      })
      .where(
        and(
          orgScope(ctx, socialAccounts),
          eq(socialAccounts.brandId, brandId),
          eq(socialAccounts.zernioAccountId, input.zernioAccountId),
        ),
      )
      .returning({ id: socialAccounts.id });
    await buildAuditInsert(
      ctx,
      {
        action: "account.sync",
        entityType: "social_account",
        entityId: input.zernioAccountId,
        metadata: { status: input.status },
      },
      tx,
    );
    return updated.length > 0;
  });
}

/**
 * Hard-delete a connected account (B3 disconnect, #31 — ADR-009 re-amended:
 * disconnect removes the row, there is no `disconnected` status). Org-scoped by
 * (org_id, id). Case A (dal/audit.ts): delete + `account.disconnect` audit run
 * in one interactive transaction. 0 rows → NotFoundError (raced), thrown before
 * the audit insert so the tx rolls back with no orphan. The Zernio-side
 * disconnect (which stops account-day billing) is the action's job, before this
 * — the DAL stays DB-only (§6).
 */
export async function deleteSocialAccountById(
  ctx: AuthCtx,
  brandId: string,
  accountId: string,
) {
  assertBrandAccess(ctx, brandId);
  return await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(socialAccounts)
      .where(
        and(
          orgScope(ctx, socialAccounts),
          eq(socialAccounts.brandId, brandId),
          eq(socialAccounts.id, accountId),
        ),
      )
      .returning({ id: socialAccounts.id });
    if (deleted.length === 0) throw new NotFoundError("account", accountId);
    await buildAuditInsert(
      ctx,
      {
        action: "account.disconnect",
        entityType: "social_account",
        entityId: accountId,
      },
      tx,
    );
    return deleted[0];
  });
}
