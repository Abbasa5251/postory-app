import "server-only";
import { db } from "@/db/db";
import { orgSettings } from "@/db/schemas/orgs";
import { orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * org_settings DAL (E1 first consumer). The 1:1 companion to the better-auth
 * organization row holds domain state we own (trial lifecycle, org defaults).
 * Org-scoped like every module (AGENTS.md §6): ctx first, orgScope in the
 * where-clause. Read-only for now — the trial/self-approval writes land with
 * their own epics (H1 trial, org-settings UI).
 */

/**
 * The §5 "approving own post" org setting (default off). Read to enforce the
 * self-approval rule in the post-approval transition (post-state
 * `assertCanApprove`). Fail-safe: a missing settings row (should not happen —
 * created 1:1 with the org) reads as `false`, the safe default, so a reviewer
 * can never self-approve by virtue of absent config.
 */
export async function getAllowSelfApproval(ctx: AuthCtx): Promise<boolean> {
  const [row] = await db
    .select({ allowSelfApproval: orgSettings.allowSelfApproval })
    .from(orgSettings)
    .where(orgScope(ctx, orgSettings))
    .limit(1);
  return row?.allowSelfApproval ?? false;
}
