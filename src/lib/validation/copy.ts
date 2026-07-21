import * as z from "zod";
import { postPlatformSchema } from "./posts";

/**
 * AI copy generation input (C2). Canonical zod home (AGENTS.md §4). The action
 * validates this, then derives model/credits from credit_rates server-side —
 * the client never supplies pricing or the model id.
 */
export const generateCopySchema = z.object({
  brandId: z.uuid(),
  // Which platform's caption to generate for (single-platform per C2; C3 does
  // cross-platform adaptation).
  platform: postPlatformSchema,
  brief: z
    .string()
    .trim()
    .min(1, "Add a brief so the AI has something to work from.")
    .max(2000, "Keep the brief under 2000 characters."),
  // How many caption variants to return in the batch (1 credit regardless).
  variantCount: z.number().int().min(1).max(5).default(3),
  // Refine loop: an existing caption to rework, plus how to change it.
  refineFrom: z.string().max(5000).optional(),
  instruction: z.string().max(1000).optional(),
});

export type GenerateCopyInput = z.infer<typeof generateCopySchema>;

/**
 * AI cross-platform adaptation input (C3 — "write once → per-platform"). One
 * master caption is adapted into a native version for each target platform. The
 * action derives model/credits from credit_rates and charges 1 credit per
 * target (a separate OpenRouter call each); the client never supplies pricing.
 */
export const adaptCopySchema = z.object({
  brandId: z.uuid(),
  // The target platforms to adapt the master caption to.
  platforms: z
    .array(postPlatformSchema)
    // Dedupe: the composer sends its target chips; a hostile client could repeat one.
    .transform((ps) => [...new Set(ps)])
    .pipe(
      z
        .array(postPlatformSchema)
        .min(1, "Select at least one platform to adapt for."),
    ),
  // The single caption the user wrote once, to be adapted per platform.
  sourceCaption: z
    .string()
    .trim()
    .min(1, "Write a caption first, then adapt it to each platform.")
    .max(5000, "Keep the caption under 5000 characters."),
});

export type AdaptCopyInput = z.infer<typeof adaptCopySchema>;
