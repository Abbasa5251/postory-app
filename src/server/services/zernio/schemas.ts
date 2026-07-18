import "server-only";
import * as z from "zod";

/**
 * Zod schemas for Zernio API responses (AGENTS.md §9: external responses are
 * parsed at the boundary, never trusted). This module is the ONLY place that
 * knows Zernio's wire shapes.
 *
 * Field names below are CONFIRMED against the Zernio OpenAPI spec v1.0.4
 * (docs.zernio.com/api/openapi, `SocialAccount` schema): the accounts list is
 * `{ accounts: SocialAccount[], hasAnalyticsAccess }`, a `SocialAccount` has
 * `_id`, `platform`, `username`, `displayName`, `profilePicture` (avatar URL,
 * may be null), `profileUrl`, `isActive`, `needsReconnection`. connect returns
 * `authUrl`; profile create returns `{ profile: { _id, … } }`. `.passthrough()`
 * + optional fields mean an unexpected-but-present field never throws; a
 * genuinely missing required field (`_id`, `platform`) still fails loudly.
 *
 * ⚠️ VERIFY (§3): the `/accounts/health` path + shape below remain best-effort
 * (the spec instead exposes `isActive`/`needsReconnection` on the list item and
 * a `status` query filter — a follow-up should move status off the guessed
 * health endpoint onto those confirmed fields).
 */

/** GET /v1/connect/{platform} → { authUrl } */
export const connectResponseSchema = z.object({
  authUrl: z.string().url(),
});

/** POST /v1/profiles → { profile: { _id, … } } */
export const profileCreateResponseSchema = z.object({
  profile: z.object({ _id: z.string().min(1) }).passthrough(),
});

/**
 * One account from GET /v1/accounts (the `SocialAccount` schema). `_id` +
 * `platform` are required; `username`/`displayName` carry the handle and
 * `profilePicture` the avatar URL (nullable per the spec — a platform that
 * exposes no picture sends null).
 */
export const zernioAccountSchema = z
  .object({
    _id: z.string().min(1),
    platform: z.string().min(1),
    username: z.string().optional(),
    displayName: z.string().optional(),
    profilePicture: z.string().nullable().optional(),
  })
  .passthrough();

/** GET /v1/accounts → { accounts: [...] } */
export const accountsResponseSchema = z.object({
  accounts: z.array(zernioAccountSchema),
});

export type ZernioAccountRaw = z.infer<typeof zernioAccountSchema>;

/** Our normalized account — what the DAL persists (status is set separately, from health). */
export type NormalizedAccount = {
  zernioAccountId: string;
  platform: string;
  handle: string;
  avatarUrl: string | null;
};

/** Map a raw Zernio account onto our columns (`SocialAccount` → our shape). */
export function normalizeAccount(raw: ZernioAccountRaw): NormalizedAccount {
  const handle = raw.username ?? raw.displayName ?? raw._id;
  const avatarUrl = raw.profilePicture ?? null;
  return {
    zernioAccountId: raw._id,
    platform: raw.platform,
    handle,
    avatarUrl,
  };
}

/**
 * Account-health entry. ⚠️ VERIFY (§3): the health response shape is not in the
 * docs. Modeled as one entry per account keyed by `_id` with an optional
 * posting-capability signal; parsed defensively so the real shape (once known)
 * needs only this schema adjusted, not the callers. Accepts either a boolean
 * `canPost` or a string `status`.
 */
export const accountHealthEntrySchema = z
  .object({
    _id: z.string().min(1),
    canPost: z.boolean().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export const accountsHealthResponseSchema = z.object({
  accounts: z.array(accountHealthEntrySchema),
});

export type AccountHealthEntry = z.infer<typeof accountHealthEntrySchema>;

/** Our two-value connection status (B3 / ADR-009 re-amended). */
export type AccountStatus = "connected" | "needs_reauth";

/**
 * Pure health → status mapping (the #30 seam). A health entry that clearly
 * cannot post → `needs_reauth` (fires the Reconnect prompt); anything else,
 * including an absent/unknown signal, is optimistically `connected` (a false
 * "connected" surfaces later as a publish failure, whereas a false
 * "needs_reauth" would nag the user to reconnect a working account).
 */
export function healthToStatus(entry: AccountHealthEntry): AccountStatus {
  // Conservative: `connected` requires a POSITIVE health signal; anything
  // unknown/absent/negative is `needs_reauth`. A false "reconnect" nag is
  // recoverable in one click, whereas a false "connected" becomes a silent
  // publish failure. ⚠️ VERIFY (§3): retune the positive-signal set once the
  // real health response shape is confirmed. (A shape mismatch fails the zod
  // parse upstream, so reconcile preserves existing statuses rather than
  // flipping everything to needs_reauth.)
  if (entry.canPost === true) return "connected";
  if (
    entry.status &&
    ["active", "connected", "ok", "healthy"].includes(
      entry.status.toLowerCase(),
    )
  ) {
    return "connected";
  }
  return "needs_reauth";
}
