import "server-only";
import * as z from "zod";

/**
 * Zod schemas for Zernio API responses (AGENTS.md §9: external responses are
 * parsed at the boundary, never trusted). This module is the ONLY place that
 * knows Zernio's wire shapes.
 *
 * ⚠️ VERIFY (§3): the docs expose some field names but not all. Confirmed from
 * docs.zernio.com examples: connect returns `authUrl`; profile create returns
 * `{ profile: { _id, name, description } }`; accounts list returns
 * `{ accounts: [{ _id, platform, … }] }` (Zernio ids are `_id`). NOT shown in
 * the docs and therefore parsed DEFENSIVELY below (confirm against the live API
 * / OpenAPI before B3 ships): the account handle/username/avatar field names,
 * and the entire account-health response shape. `.passthrough()` + optional
 * field unions mean an unexpected-but-present field never throws; a genuinely
 * missing required field (`_id`, `platform`) still fails loudly.
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
 * One account from GET /v1/accounts. `_id` + `platform` are documented and
 * required; the display fields below are best-effort (VERIFY) — Zernio may name
 * them differently, so several candidates are accepted and normalized.
 */
export const zernioAccountSchema = z
  .object({
    _id: z.string().min(1),
    platform: z.string().min(1),
    username: z.string().optional(),
    handle: z.string().optional(),
    name: z.string().optional(),
    displayName: z.string().optional(),
    picture: z.string().optional(),
    avatar: z.string().optional(),
    avatarUrl: z.string().optional(),
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

/** Map a raw Zernio account onto our columns, picking whichever display field is present. */
export function normalizeAccount(raw: ZernioAccountRaw): NormalizedAccount {
  const handle =
    raw.username ?? raw.handle ?? raw.displayName ?? raw.name ?? raw._id;
  const avatarUrl = raw.picture ?? raw.avatar ?? raw.avatarUrl ?? null;
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
