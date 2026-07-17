import "server-only";
import { auth } from "./auth";
import { selectInitialOrganizationId } from "./select-initial-org";

/**
 * Active-organization recovery for the routing gates.
 *
 * POSTORY is org-required — no personal mode (D1/A3) — so a member should never
 * sit in a session with a null `activeOrganizationId`. It can still happen
 * (e.g. a session minted before the org existed, or the active org cleared),
 * and the `(dashboard)` gate would then mistake it for "needs onboarding".
 *
 * Call this ONLY when the session has no active org. When the user belongs to
 * at least one organization, it sets their earliest-membership org active — the
 * SAME policy as the session-create hook in `auth.ts` (both use
 * `selectInitialOrganizationId`, so sign-in and recovery pick the same tenant) —
 * and returns `"recovered"`; the caller should then redirect so a fresh request
 * reads the persisted value (better-auth's `getSession` can be request-memoized).
 * Returns `"none"` when the user belongs to no organization (needs onboarding).
 */
export async function recoverActiveOrg(
  headers: Headers,
  userId: string,
): Promise<"recovered" | "none"> {
  // Same better-auth adapter the session-create hook uses (member table is
  // better-auth-owned → adapter, not drizzle; AGENTS.md §6).
  const { adapter } = await auth.$context;
  const organizationId = await selectInitialOrganizationId(adapter, userId);
  if (!organizationId) return "none";

  await auth.api.setActiveOrganization({
    headers,
    body: { organizationId },
  });
  return "recovered";
}
