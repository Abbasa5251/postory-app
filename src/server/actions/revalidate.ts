import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Revalidate the surfaces a post transition / comment can affect: the brand
 * composer (edit lock + reviewer note + comments), the brand posts list, and
 * the cross-brand review queue (E2). Shared by the post + comment actions (§4)
 * — it can't live in a `"use server"` module (those may only export async
 * functions), so it sits here as a plain server helper.
 */
export function revalidatePostSurfaces(brandId: string): void {
  revalidatePath(`/brands/${brandId}/composer`);
  revalidatePath(`/brands/${brandId}/posts`);
  revalidatePath("/approvals");
}
