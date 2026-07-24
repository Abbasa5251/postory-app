import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/db";
import { member, user } from "@/db/schemas/auth";
import { brandMembers } from "@/db/schemas/brands";
import { NotFoundError } from "@/server/domain/errors";
import { recordAuditEvent } from "./audit";
import { assertBrandAccess, brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Brand-assignment DAL (B5) — the rows that scope a `creator` to their Brands.
 * Org-scoped like every DAL module (AGENTS.md §6): ctx first, orgScope in every
 * query, brand access asserted. Only owner/admin reach the mutations (the
 * action's `brand:assign` gate); the assignment only *gates* creators, but a row
 * may be stored for any member (owner/admin/approver see all Brands regardless —
 * the row is inert for them, resolved in getAuthCtx in B5.2).
 *
 * `resolveCreatorBrandIds` (the getAuthCtx bootstrap read) is the ONE
 * documented exception to §6's ctx-first rule — see its doc-comment below.
 */

/**
 * Resolve a creator's assigned brand ids — the getAuthCtx bootstrap read (B5.2).
 *
 * The ONE documented §6 exception: it takes raw `orgId` + `memberId`, NOT an
 * `AuthCtx`, because it *builds* the `AuthCtx.brandIds` that every other DAL
 * method demands (the ctx bootstrap cycle — a method that constructs the ctx
 * cannot itself require one). It stays org-scoped by the explicit
 * `eq(brandMembers.orgId, orgId)` predicate — NOT `orgScope()`, which needs a
 * ctx — and `orgId` originates from `session.session.activeOrganizationId`
 * (getAuthCtx), never client input, so tenancy holds. Only getAuthCtx calls
 * this, and only for `role === "creator"`; every other role short-circuits to
 * "all" and never reaches here.
 */
export async function resolveCreatorBrandIds(
  orgId: string,
  memberId: string,
): Promise<string[]> {
  const rows = await db
    .select({ brandId: brandMembers.brandId })
    .from(brandMembers)
    .where(
      and(eq(brandMembers.orgId, orgId), eq(brandMembers.memberId, memberId)),
    );
  return rows.map((r) => r.brandId);
}

/**
 * Prove the target member belongs to the caller's org BEFORE writing an
 * assignment. There is no composite FK for `brand_members.member_id → org`
 * (the better-auth `member` table has no usable unique key — schema/A5 note),
 * so this read is the tenancy boundary: without it a tampered action payload
 * could smuggle a foreign org's member id into our rows. Read-only access to a
 * better-auth-owned table is permitted (§6). Not `orgScope` — the `member`
 * table's tenant column is `organization_id`, not our `org_id` convention.
 */
async function assertMemberInOrg(
  ctx: AuthCtx,
  memberId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.id, memberId)))
    .limit(1);
  if (!row) throw new NotFoundError("member", memberId);
}

/** The member ids assigned to a brand: org + brand scoped, brand-access-checked. */
export async function listBrandMemberIds(
  ctx: AuthCtx,
  brandId: string,
): Promise<string[]> {
  assertBrandAccess(ctx, brandId);
  const rows = await db
    .select({ memberId: brandMembers.memberId })
    .from(brandMembers)
    .where(and(orgScope(ctx, brandMembers), eq(brandMembers.brandId, brandId)));
  return rows.map((r) => r.memberId);
}

/** A brand-assigned member with display identity (for the @mention picker, E3). */
export type BrandMember = { id: string; name: string };

/**
 * Members ASSIGNED to a set of brands with their display names (E3 @mention
 * picker), as flat `{ brandId, id, name }` rows for the caller to group. Joins
 * brand_members → member → user; org-scoped + brandScope (defense-in-depth) so a
 * creator only ever resolves their assigned brands. Empty input → no query.
 * Any role may be assigned (brand_members holds owner/admin/approver/creator —
 * the brand's team roster), so this is the brand's collaborators, not just its
 * creators.
 */
export async function listBrandMembersForBrands(
  ctx: AuthCtx,
  brandIds: string[],
): Promise<{ brandId: string; id: string; name: string }[]> {
  if (brandIds.length === 0) return [];
  return db
    .select({ brandId: brandMembers.brandId, id: member.id, name: user.name })
    .from(brandMembers)
    .innerJoin(member, eq(member.id, brandMembers.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        orgScope(ctx, brandMembers),
        inArray(brandMembers.brandId, brandIds),
        brandScope(ctx, brandMembers.brandId),
      ),
    )
    .orderBy(user.name);
}

/** Members assigned to ONE brand (E3 @mention picker) — the single-brand wrapper. */
export async function listBrandMembers(
  ctx: AuthCtx,
  brandId: string,
): Promise<BrandMember[]> {
  assertBrandAccess(ctx, brandId);
  const rows = await listBrandMembersForBrands(ctx, [brandId]);
  return rows.map(({ id, name }) => ({ id, name }));
}

/**
 * The brand ids one member is assigned to (B5.3) — the mirror of
 * listBrandMemberIds, read from the member's side for the member-centric
 * surface. Org + member scoped; no assertBrandAccess, because this lists a
 * member's own assignments rather than gating access to a single named brand —
 * orgScope is the tenancy guarantee (§6.4). The caller (owner/admin only) is
 * gated at the page/action, and every row it returns is provably in ctx.orgId.
 */
export async function listBrandIdsForMember(
  ctx: AuthCtx,
  memberId: string,
): Promise<string[]> {
  const rows = await db
    .select({ brandId: brandMembers.brandId })
    .from(brandMembers)
    .where(
      and(orgScope(ctx, brandMembers), eq(brandMembers.memberId, memberId)),
    );
  return rows.map((r) => r.brandId);
}

/**
 * Assign a member to a brand (idempotent). org_id is written from the ctx,
 * never input. The target member is proven in-org first (assertMemberInOrg),
 * then the row is inserted with `onConflictDoNothing` on the
 * `(brand_id, member_id)` unique — a duplicate is a no-op that writes no audit
 * (mirrors insertSocialAccount, §7 I2). Case B (dal/audit.ts): the uuidv7 id is
 * DB-generated, so insert then audit with the returned id. Returns the new row,
 * or null when the assignment already existed.
 */
export async function assignMember(
  ctx: AuthCtx,
  brandId: string,
  memberId: string,
) {
  assertBrandAccess(ctx, brandId);
  await assertMemberInOrg(ctx, memberId);
  const [row] = await db
    .insert(brandMembers)
    .values({ orgId: ctx.orgId, brandId, memberId })
    .onConflictDoNothing({
      target: [brandMembers.brandId, brandMembers.memberId],
    })
    .returning();
  if (!row) return null; // already assigned — idempotent no-op, no audit
  await recordAuditEvent(ctx, {
    action: "brand.member.assign",
    entityType: "brand_member",
    entityId: row.id,
    metadata: { memberId },
  });
  return row;
}

/**
 * Unassign a member from a brand (idempotent). Org + brand + member scoped, so
 * it can only ever touch the caller's own row. A 0-row delete is an idempotent
 * no-op returning null — NOT a NotFoundError: this backs a toggle, so
 * re-unassigning an already-removed member must succeed quietly.
 *
 * Sequenced delete-then-audit (not the Case-A batch) precisely so the audit is
 * written ONLY when a row actually changed — symmetric with assignMember, which
 * likewise skips the audit on its no-op. A batch would build the audit insert
 * up-front and emit a phantom `brand.member.unassign` event on every redundant
 * toggle. Trade-off: the Case-B residual (a delete whose audit insert then
 * throws leaves an unaudited delete) — the same manual-remediation orphan the
 * codebase already accepts for uuidv7 creates (dal/audit.ts), and strictly
 * better than false audit events.
 */
export async function unassignMember(
  ctx: AuthCtx,
  brandId: string,
  memberId: string,
) {
  assertBrandAccess(ctx, brandId);
  const [deleted] = await db
    .delete(brandMembers)
    .where(
      and(
        orgScope(ctx, brandMembers),
        eq(brandMembers.brandId, brandId),
        eq(brandMembers.memberId, memberId),
      ),
    )
    .returning({ id: brandMembers.id });
  if (!deleted) return null; // nothing assigned — idempotent no-op, no audit
  await recordAuditEvent(ctx, {
    action: "brand.member.unassign",
    entityType: "brand_member",
    entityId: deleted.id,
    metadata: { memberId },
  });
  return deleted;
}
