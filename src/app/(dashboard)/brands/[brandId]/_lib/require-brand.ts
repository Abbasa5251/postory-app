import "server-only";
import { notFound } from "next/navigation";
import { getAuthCtx } from "@/server/auth/context";
import { getBrandById } from "@/server/dal/brands";
import { NotFoundError } from "@/server/domain/errors";

/**
 * Resolve a brand for a brand-scoped page, 404-ing on cross-org / unassigned /
 * nonexistent (all the same shape, §7). The org + brand-access scoping lives in
 * getBrandById; this just maps the NotFoundError to Next's notFound(). Used by
 * the brand nav's routes (dashboard + the not-yet-built placeholder screens).
 */
export async function requireBrand(brandId: string) {
  const ctx = await getAuthCtx();
  try {
    return await getBrandById(ctx, brandId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
