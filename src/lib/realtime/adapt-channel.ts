import { channel } from "inngest/realtime";
import * as z from "zod";
import { postPlatformSchema } from "@/lib/validation/posts";

/**
 * Realtime channel for AI cross-platform adaptation (C3). A per-generation-job
 * channel: each run streams to `adapt:{jobId}`. Shared contract — the Inngest
 * job publishes to it, the composer subscribes via `useRealtime`. Lives in
 * src/lib (isomorphic, no server imports) so both sides import the same def.
 *
 * Unlike the copy channel (C2), adaptation fans out one call per platform, so
 * results arrive per platform: an `adapted` message lands as each target's
 * caption completes (the composer fills that tab), then a single `done` reports
 * which platforms failed (if any) AND re-broadcasts every produced caption so
 * the client can apply any it missed when an `adapted` message was dropped.
 * `error` is a terminal job-level failure (e.g. reserve failed) — reserved
 * credits already refunded.
 *
 * The subscription token minted for this channel is scoped to a single jobId
 * the caller just created (server action), so it can't read another org's stream.
 */
export const adaptChannel = channel({
  name: (jobId: string) => `adapt:${jobId}`,
  topics: {
    // One completed platform adaptation — fills that platform's caption tab.
    adapted: {
      schema: z.object({
        platform: postPlatformSchema,
        caption: z.string(),
      }),
    },
    // Completion signal: which platforms failed to generate + which were blocked
    // by D5 moderation (generated but withheld) + every PASSED caption (durable
    // fallback for any `adapted` message the client missed).
    done: {
      schema: z.object({
        failed: z.array(postPlatformSchema),
        blocked: z.array(postPlatformSchema),
        captions: z.array(
          z.object({ platform: postPlatformSchema, caption: z.string() }),
        ),
      }),
    },
    // Terminal job-level failure (reserved credits already refunded).
    error: { schema: z.object({ message: z.string() }) },
  },
});
