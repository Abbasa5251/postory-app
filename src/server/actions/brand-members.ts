"use server";

import { revalidatePath } from "next/cache";
import { assignMemberSchema } from "@/lib/validation/brand-members";
import {
  assignMember as assignMemberInDal,
  unassignMember as unassignMemberInDal,
} from "@/server/dal/brand-members";
import { getBrandById } from "@/server/dal/brands";
import { withAction } from "./with-action";

/**
 * Brand-assignment server actions (B5). Authored through `withAction` (ADR-013 /
 * §7): the wrapper validates, authenticates, and authorizes `brand:assign`
 * (owner/admin only); each handler does the §7 step-4 scoped fetch so a
 * cross-org / nonexistent brand 404s before any write, then delegates to the
 * DAL (which proves the target member is in-org and pairs its own audit) and
 * revalidates the brand's settings page.
 */
export const assignMember = withAction(
  assignMemberSchema,
  "brand:assign",
  async (data, ctx) => {
    await getBrandById(ctx, data.brandId);
    await assignMemberInDal(ctx, data.brandId, data.memberId);
    revalidatePath(`/brands/${data.brandId}/settings`);
    return { brandId: data.brandId, memberId: data.memberId };
  },
);

export const unassignMember = withAction(
  assignMemberSchema,
  "brand:assign",
  async (data, ctx) => {
    await getBrandById(ctx, data.brandId);
    await unassignMemberInDal(ctx, data.brandId, data.memberId);
    revalidatePath(`/brands/${data.brandId}/settings`);
    return { brandId: data.brandId, memberId: data.memberId };
  },
);
