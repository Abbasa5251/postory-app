import * as z from "zod";
import {
  PLATFORMS,
  PLATFORM_CONFIG,
  type Platform,
} from "@/lib/platforms/config";

/**
 * Post / composer input schemas (C1). Canonical zod home per AGENTS.md §4 —
 * compose, never redeclare. Validated at the server-action boundary (§7/§9)
 * and reused by the client composer for parity between the live char counter
 * and what actually persists.
 *
 * `postContentSchema` defines the shape stored in `post_versions.content`
 * (the "opaque, shaped by Epic C" JSONB column): the selected target platforms
 * plus one caption variant per target. Per-platform caption ceilings come from
 * the single source of truth (`PLATFORM_CONFIG[p].charLimit`, PRD §6), never
 * hardcoded here.
 */

/** A launch platform id — built from the config tuple so the list stays single-sourced. */
export const postPlatformSchema = z.enum(PLATFORMS);

/** One platform's caption variant. Empty is allowed — a draft may be incomplete. */
const captionVariantSchema = z.object({
  caption: z.string(),
});

export const postContentSchema = z
  .object({
    targets: z
      .array(postPlatformSchema)
      // Dedupe: the composer toggles chips, a hostile client could repeat one.
      .transform((ts) => [...new Set(ts)])
      .pipe(
        z
          .array(postPlatformSchema)
          .min(1, "Select at least one platform to publish to."),
      ),
    // partialRecord (not record): only targeted platforms carry a variant;
    // a full Record would force all six keys to be present.
    variants: z.partialRecord(postPlatformSchema, captionVariantSchema),
  })
  .superRefine((content, ctx) => {
    for (const platform of content.targets) {
      const variant = content.variants[platform];
      if (!variant) {
        ctx.addIssue({
          code: "custom",
          message: `Missing caption for ${PLATFORM_CONFIG[platform].label}.`,
          path: ["variants", platform],
        });
        continue;
      }
      const limit = PLATFORM_CONFIG[platform].charLimit;
      if (variant.caption.length > limit) {
        ctx.addIssue({
          code: "custom",
          message: `${PLATFORM_CONFIG[platform].label} caption must be at most ${limit.toLocaleString()} characters.`,
          path: ["variants", platform, "caption"],
        });
      }
    }
  });

/** The canonical `post_versions.content` shape (C1-owned). */
export type PostContent = z.infer<typeof postContentSchema>;

/**
 * Save-draft input (C1). `postId` present → edit an existing DRAFT; absent →
 * create a new one. `brandId`/`postId` are re-checked server-side against the
 * caller's org + brand access in the DAL (§7); the client is hostile.
 */
export const saveDraftSchema = z.object({
  brandId: z.uuid("Brand id is required."),
  postId: z.uuid().optional(),
  content: postContentSchema,
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

/** Convenience: the empty content a fresh composer starts from. */
export function emptyPostContent(): PostContent {
  return { targets: [], variants: {} };
}

/** Narrow unknown JSONB (a stored `post_versions.content`) to `PostContent`. */
export function parsePostContent(value: unknown): PostContent {
  return postContentSchema.parse(value);
}

// Re-export for consumers that only need the platform type alongside content.
export type { Platform };
