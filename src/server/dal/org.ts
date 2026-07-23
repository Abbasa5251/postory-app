import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/db";
import { member, organization, user } from "@/db/schemas/auth";
import type { AuthCtx } from "./types";

/**
 * Read-only helpers over the better-auth-owned org tables (AGENTS.md §6: these
 * tables are accessed via better-auth APIs OR read-only DAL helpers here —
 * never written with drizzle). Org-scoped by ctx like every DAL read, so no
 * caller can enumerate another tenant's members.
 */

export type OrgMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  /**
   * Raw better-auth role string (usually one of owner/admin/approver/creator;
   * kept as `string` because better-auth may return other values). Consumers
   * treat it as display/UX only — never as an authorization decision.
   */
  role: string;
};

/**
 * The organization's members with their display identity (name/email from the
 * better-auth `user` table). Org-scoped by ctx.orgId — an explicit
 * `member.organization_id` predicate, not `orgScope()`, because the better-auth
 * `member` table's tenant column is `organization_id`, not our `org_id`
 * convention. An agency has ≤10 seats (D1), so the whole team is one read; no
 * pagination.
 */
/**
 * The active organization's display name — a single-column, single-row read
 * scoped to ctx.orgId. Much cheaper than better-auth's getFullOrganization
 * (which also loads members/invitations); the app shell only needs the name.
 * Memoized per-request (React `cache()`).
 */
export const getActiveOrgName = cache(
  async (ctx: AuthCtx): Promise<string | null> => {
    const [row] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, ctx.orgId))
      .limit(1);
    return row?.name ?? null;
  },
);

export async function listOrgMembers(ctx: AuthCtx): Promise<OrgMember[]> {
  return db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(user.name);
}

/**
 * Every organization id — the ONE deliberately un-scoped, system-only DAL read
 * (D4 orphan-cleanup sweep, AGENTS.md §10). Takes NO AuthCtx and applies NO
 * org filter by design: a weekly cross-tenant sweep must enumerate all orgs so
 * it can then build a per-org `getSystemCtx(orgId, …)` and run the ordinary
 * org-scoped media DAL against each (staying inside the tenancy model — §6).
 *
 * This is the only place org enumeration is allowed; it exposes nothing but
 * ids and must never be reachable from a request/action path (§13 hotspot —
 * flagged for review). Any tenant DATA still flows through the org-scoped DAL.
 */
export async function listOrgIdsForSweep(): Promise<string[]> {
  const rows = await db.select({ id: organization.id }).from(organization);
  return rows.map((r) => r.id);
}
