import * as z from "zod";
import { isValidTimeZone } from "@/lib/timezones";

/**
 * Brand input schemas (B1). Canonical zod home per AGENTS.md §4 — compose,
 * never redeclare. `slug` is derived server-side (never user input), so it is
 * absent here. Validated at the server-action boundary (§7/§9).
 */
export const createBrandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Brand name must be at least 2 characters.")
    .max(80, "Brand name must be at most 80 characters."),
  // IANA zone; re-checked server-side because the client is hostile (§7). The
  // brand's timezone drives scheduling (§9, Epic F).
  timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone."),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

/**
 * Update input (B1.2). Same editable fields as create — slug is immutable and
 * derived, so it is never an input — plus the target brand `id`. Composes
 * createBrandSchema so the name/timezone rules stay single-sourced (§4).
 */
export const updateBrandSchema = createBrandSchema.extend({
  id: z.string().min(1, "Brand id is required."),
});

export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
