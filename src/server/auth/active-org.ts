import "server-only";
import { auth } from "./auth";

/**
 * Active-organization recovery for the routing gates.
 *
 * POSTORY is org-required — no personal mode (D1/A3) — so a member should never
 * sit in a session with a null `activeOrganizationId`. It can still happen
 * (e.g. a session minted before the org existed, or the active org cleared),
 * and the `(dashboard)` gate would then mistake it for "needs onboarding".
 *
 * Call this ONLY when the session has no active org. When the user belongs to
 * at least one organization, it sets their earliest org as active — mirroring
 * the session-create hook in `auth.ts` — and returns `"recovered"`; the caller
 * should then redirect so a fresh request reads the persisted value (better-auth's
 * `getSession` can be request-memoized). Returns `"none"` when the user belongs
 * to no organization (genuinely needs onboarding).
 */
export async function recoverActiveOrg(
  headers: Headers,
): Promise<"recovered" | "none"> {
  const organizations = await auth.api.listOrganizations({ headers });
  if (!organizations || organizations.length === 0) return "none";

  const earliest = [...organizations].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0];

  await auth.api.setActiveOrganization({
    headers,
    body: { organizationId: earliest.id },
  });
  return "recovered";
}
