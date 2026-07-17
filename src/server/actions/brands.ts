"use server";

import { revalidatePath } from "next/cache";
import { createBrandSchema } from "@/lib/validation/brands";
import { createBrand as createBrandInDal } from "@/server/dal/brands";
import { withAction } from "./with-action";

/**
 * Brand server actions (B1). Authored through `withAction` (ADR-013 / §7): the
 * wrapper validates, authenticates, and authorizes; the handler owns the scoped
 * DAL call (which pairs its own audit), then revalidates the list.
 */
export const createBrand = withAction(
  createBrandSchema,
  "brand:create",
  async (data, ctx) => {
    const brand = await createBrandInDal(ctx, data);
    revalidatePath("/brands");
    // Minimal data — never raw rows with other-tenant refs (§7).
    return { id: brand.id, name: brand.name };
  },
);
