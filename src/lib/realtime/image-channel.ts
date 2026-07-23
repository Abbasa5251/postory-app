import { channel } from "inngest/realtime";
import * as z from "zod";

/**
 * Realtime channel for AI image generation (D2/D3). A per-generation-job
 * channel: each run streams to `image:{jobId}`. Shared contract — the Inngest
 * job publishes, the composer subscribes via `useRealtime`. Lives in src/lib
 * (isomorphic, no server imports) so both sides import the same def.
 *
 * Like the adapt channel (C3), image generation fans out one call per variant,
 * so results arrive per variant: an `asset` message lands as each image
 * completes (stored in R2 + recorded), then a single `done` reports how many
 * variants failed AND re-broadcasts every produced asset so the client can show
 * any it missed when an `asset` message was dropped. `error` is a terminal
 * job-level failure (e.g. reserve failed) — reserved credits already refunded.
 *
 * The subscription token minted for this channel is scoped to a single jobId
 * the caller just created (server action), so it can't read another org's stream.
 */

/**
 * A serving-ready generated asset — the same shape as the composer's
 * `MediaAssetView` (so the client attaches it through the existing `attachMedia`
 * seam). Generated assets are always images at launch (video is D7).
 */
const generatedAssetSchema = z.object({
  id: z.string(),
  kind: z.literal("image"),
  url: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  moderationStatus: z.string(),
});

export const imageChannel = channel({
  name: (jobId: string) => `image:${jobId}`,
  topics: {
    // One completed image variant — stored + recorded, ready to attach.
    asset: { schema: generatedAssetSchema },
    // Completion signal: how many variants failed + every produced asset
    // (durable fallback for any `asset` message the client missed).
    done: {
      schema: z.object({
        failed: z.number().int(),
        assets: z.array(generatedAssetSchema),
      }),
    },
    // Terminal job-level failure (reserved credits already refunded).
    error: { schema: z.object({ message: z.string() }) },
  },
});
