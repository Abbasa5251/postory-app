"use server";

import { revalidatePath } from "next/cache";
import {
  createBrandSchema,
  updateBrandContactSchema,
  updateBrandSchema,
  updateBrandVoiceSchema,
} from "@/lib/validation/brands";
import {
  createBrand as createBrandInDal,
  getBrandById,
  updateBrand as updateBrandInDal,
  updateBrandContact as updateBrandContactInDal,
  updateBrandVoice as updateBrandVoiceInDal,
} from "@/server/dal/brands";
import { withAction } from "./with-action";

// Both B2 saves share this after-write step: refresh the list + settings page.
function revalidateBrand(id: string) {
  revalidatePath("/brands");
  revalidatePath(`/brands/${id}/settings`);
}

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

export const updateBrand = withAction(
  updateBrandSchema,
  "brand:update",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch: cross-org / nonexistent ids 404 here, before
    // any write (the DAL's own scoping is belt-and-suspenders on top).
    await getBrandById(ctx, data.id);
    const brand = await updateBrandInDal(ctx, data.id, {
      name: data.name,
      timezone: data.timezone,
    });
    revalidateBrand(data.id);
    return { id: brand.id, name: data.name };
  },
);

export const updateBrandVoice = withAction(
  updateBrandVoiceSchema,
  "brand:update",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch: cross-org / nonexistent 404 before any write.
    await getBrandById(ctx, data.id);
    const brand = await updateBrandVoiceInDal(ctx, data.id, data.voiceProfile);
    revalidateBrand(data.id);
    return { id: brand.id };
  },
);

export const updateBrandContact = withAction(
  updateBrandContactSchema,
  "brand:update",
  async (data, ctx) => {
    await getBrandById(ctx, data.id);
    const brand = await updateBrandContactInDal(
      ctx,
      data.id,
      data.clientContactEmail,
    );
    revalidateBrand(data.id);
    return { id: brand.id };
  },
);
