import * as z from "zod";
import { IMAGE_ASPECT_PRESET_IDS } from "@/lib/platforms/config";
import { postPlatformSchema } from "./posts";

/**
 * AI image generation input (D1/D3). Canonical zod home (AGENTS.md §4). The
 * action validates this, then derives the model id + per-image credit cost from
 * `credit_rates` server-side (the `tier` maps to the `image_standard` /
 * `image_premium` rate action) — the client never supplies pricing or the model
 * id (ADR-012).
 */
export const generateImageSchema = z.object({
  brandId: z.uuid(),
  prompt: z
    .string()
    .trim()
    .min(1, "Describe the image you want to generate.")
    .max(2000, "Keep the prompt under 2000 characters."),
  // Model tier → credit_rates action (image_standard | image_premium). The
  // server maps this to the rate; the client never sends the model id/price.
  tier: z.enum(["standard", "premium"]).default("standard"),
  // Output aspect ratio — one of the D1 presets (1:1, 4:5, 9:16, 16:9). The
  // value is also the wire `aspectRatio` string.
  aspectRatio: z.enum(IMAGE_ASPECT_PRESET_IDS).default("1:1"),
  // How many variants to generate — one OpenRouter call each (fan-out), so N
  // credits reserved, only successes settled (PRD §7.2 image tiers).
  variantCount: z.number().int().min(2).max(4).default(2),
  // The platform the generation is seeded for (optional — used only for the
  // prompt's style hint + advisory aspect defaults; the asset is brand-scoped,
  // not platform-bound, like an upload).
  platform: postPlatformSchema.optional(),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;
