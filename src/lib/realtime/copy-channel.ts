import { channel } from "inngest/realtime";
import * as z from "zod";

/**
 * Realtime channel for AI copy generation (C2). A per-generation-job channel:
 * each run streams to `copy:{jobId}`. Shared contract — the Inngest job
 * publishes to it, the composer subscribes via `useRealtime`. Lives in
 * src/lib (isomorphic, no server imports) so both sides import the same def.
 *
 * The subscription token minted for this channel is scoped to a single jobId
 * the caller just created (server action), so it can't be used to read another
 * org's stream.
 */
export const copyChannel = channel({
  name: (jobId: string) => `copy:${jobId}`,
  topics: {
    // Incremental text deltas — the live "typing" effect in the UI.
    chunk: { schema: z.object({ text: z.string() }) },
    // Final parsed caption variants once generation completes — only those that
    // PASSED D5 moderation. `blocked` is how many were withheld (flagged unsafe)
    // so the UI can show a notice; the batch is still charged.
    done: {
      schema: z.object({
        variants: z.array(z.string()),
        blocked: z.number().int(),
      }),
    },
    // Terminal failure (reserved credits already refunded).
    error: { schema: z.object({ message: z.string() }) },
  },
});
