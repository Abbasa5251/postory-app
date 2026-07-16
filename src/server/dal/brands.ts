import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { brands } from "@/db/schemas/brands";
import { NotFoundError } from "@/server/domain/errors";
import { assertBrandAccess, brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Brands DAL — the reference org-scoped module (AGENTS.md §6): mandatory
 * ctx first argument, orgScope in every where-clause, brand narrowing for
 * creators, cross-org reads indistinguishable from not-found.
 *
 * Read-only in A5. B1 adds the mutations, which must pair each write with
 * the audit template in dal/audit.ts.
 */

/** All brands the caller can see: org-scoped, narrowed to assigned brands for creators. */
export async function listBrands(ctx: AuthCtx) {
  return db
    .select()
    .from(brands)
    .where(and(orgScope(ctx, brands), brandScope(ctx, brands.id)))
    .orderBy(brands.name);
}

/**
 * One brand by id. Throws NotFoundError for nonexistent, cross-org and
 * unassigned-to-creator alike (AGENTS.md §7 — same 404 shape).
 */
export async function getBrandById(ctx: AuthCtx, brandId: string) {
  assertBrandAccess(ctx, brandId);
  const [row] = await db
    .select()
    .from(brands)
    .where(and(orgScope(ctx, brands), eq(brands.id, brandId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError("brand", brandId);
  }
  return row;
}
