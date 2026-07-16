import "server-only";
import { eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { NotFoundError } from "@/server/domain/errors";
import type { AuthCtx } from "./types";

/**
 * Tenancy scoping primitives (AGENTS.md §6). Every DAL query composes these;
 * none of them is optional decoration:
 *
 *   db.select().from(t).where(and(orgScope(ctx, t), ...rest))
 *
 * `orgScope` is ALWAYS the first argument of and() — it returns SQL (never
 * undefined), so the org filter can never be silently dropped the way an
 * optional condition can. The authz suite greps queries for exactly this.
 */

/** The mandatory org_id predicate. Compile error for tables without org_id. */
export function orgScope(ctx: AuthCtx, table: { orgId: AnyPgColumn }): SQL {
  return eq(table.orgId, ctx.orgId);
}

/**
 * Pre-query guard for a caller-supplied brandId. Throws NotFoundError, not
 * ForbiddenError: an unassigned brand must be indistinguishable from a
 * nonexistent one (AGENTS.md §7). Convenience pre-check ONLY — it never
 * replaces orgScope in the SQL (belt AND suspenders, §6.4).
 */
export function assertBrandAccess(ctx: AuthCtx, brandId: string): void {
  if (ctx.brandIds !== "all" && !ctx.brandIds.includes(brandId)) {
    throw new NotFoundError("brand", brandId);
  }
}

/**
 * List-query narrowing to the ctx's brand access. undefined = unrestricted
 * ("all" — and() drops it); an empty brandIds array renders SQL `false`
 * (drizzle inArray with []), so a creator with no assigned brands matches
 * nothing rather than everything.
 */
export function brandScope(
  ctx: AuthCtx,
  brandIdColumn: AnyPgColumn,
): SQL | undefined {
  return ctx.brandIds === "all"
    ? undefined
    : inArray(brandIdColumn, ctx.brandIds);
}
