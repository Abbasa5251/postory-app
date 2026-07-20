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
