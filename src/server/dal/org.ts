import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/db";
import { member, organization, user } from "@/db/schemas/auth";
import { posts } from "@/db/schemas/posts";
import { roleGrantsReview } from "@/server/auth/permissions";
import { orgScope } from "./scope";
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
 * A member to notify by email (E3). memberId is the better-auth member.id used
 * to exclude the actor from their own event's recipients.
 */
export type NotifyRecipient = {
  memberId: string;
  name: string;
  email: string;
};

/**
 * The org's internal reviewers (owner/admin/approver — roleGrantsReview),
 * mapped to notify recipients. E3 emails these on submit. Reviewers see every
 * brand (§7), so this is org-wide, not brand-scoped. Reuses listOrgMembers
 * (≤10 seats, one read). Usable from a system ctx (the notification job).
 */
export async function listOrgReviewers(
  ctx: AuthCtx,
): Promise<NotifyRecipient[]> {
  const members = await listOrgMembers(ctx);
  return members
    .filter((m) => roleGrantsReview(m.role))
    .map((m) => ({ memberId: m.id, name: m.name, email: m.email }));
}

/**
 * The author of a post (posts.created_by → member → user), org-scoped, or null
 * if the post is gone or its author's seat was removed (createdBy SET NULL →
 * the inner join drops the row: no one to notify). E3 emails the author on
 * approve / request-changes. Usable from a system ctx (the notification job).
 */
export async function getPostAuthor(
  ctx: AuthCtx,
  postId: string,
): Promise<NotifyRecipient | null> {
  const [row] = await db
    .select({ memberId: member.id, name: user.name, email: user.email })
    .from(posts)
    .innerJoin(member, eq(member.id, posts.createdBy))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
    .limit(1);
  return row ?? null;
}

/**
 * Members of THIS org among the given ids, as notify recipients. Org-scoped
 * (member.organization_id — better-auth's tenant column), so a cross-org id
 * silently drops out. Powers both @mention target validation (comments DAL)
 * and mention-email resolution (the notification job). Empty input → no query.
 */
export async function getMembersByIds(
  ctx: AuthCtx,
  memberIds: string[],
): Promise<NotifyRecipient[]> {
  if (memberIds.length === 0) return [];
  return db
    .select({ memberId: member.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(eq(member.organizationId, ctx.orgId), inArray(member.id, memberIds)),
    );
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
