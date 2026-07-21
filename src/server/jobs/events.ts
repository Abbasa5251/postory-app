import "server-only";
import { eventType } from "inngest";
import * as z from "zod";
import { postPlatformSchema } from "@/lib/validation/posts";

/**
 * Typed event definitions (Inngest v4 `eventType`). Each is used both as a
 * function trigger and for `inngest.send(<event>.create(data))`, so payloads
 * are type-checked at every send site. Generation/publishing events join this
 * file as their epics land (C2, D, F).
 *
 * Schemas must be transform-free (Inngest requires input === output); do the
 * real validation in the action with the app's zod schemas before sending.
 */

/** Wiring check only — no product meaning (see system/health.ping). */
export const healthPingEvent = eventType("system/health.ping");

/**
 * Already-normalized brand voice (B2) shared by the copy + adapt events — a
 * transform-free mirror of VoiceProfile so the Inngest schema (no transforms
 * allowed) accepts it. The action validates the stored jsonb before sending.
 */
const voiceProfileEventSchema = z
  .object({
    tone: z.string().optional(),
    bannedWords: z.array(z.string()).optional(),
    hashtags: z.array(z.string()).optional(),
    samplePosts: z.array(z.string()).optional(),
  })
  .nullable();

/**
 * AI copy generation requested (C2). Emitted by the generateCopy action after
 * it has validated input, authorized, reserved nothing yet, and created the
 * queued generation_jobs row; the worker reserves credits, streams via
 * OpenRouter, and settles/refunds. Fields are already-trusted (server-derived):
 * orgId/credits/modelId come from the ctx + credit_rates, not client input.
 */
export const copyRequestedEvent = eventType("generation/copy.requested", {
  schema: z.object({
    orgId: z.string(),
    jobId: z.string(),
    brandId: z.string(),
    credits: z.number().int(),
    modelId: z.string(),
    platform: postPlatformSchema,
    brief: z.string(),
    // Already-normalized brand voice (B2) — a transform-free mirror of
    // VoiceProfile so the Inngest schema (no transforms allowed) accepts it.
    voiceProfile: voiceProfileEventSchema,
    variantCount: z.number().int(),
    refineFrom: z.string().optional(),
    instruction: z.string().optional(),
  }),
});

/**
 * AI cross-platform adaptation requested (C3). Emitted by the adaptCopy action
 * after it has validated input, authorized, and created the queued
 * generation_jobs row; the worker reserves N credits (one per platform),
 * adapts per platform via OpenRouter, and settles / refunds failed platforms.
 * Fields are already-trusted (server-derived): orgId/creditsPerPlatform/modelId
 * come from the ctx + credit_rates, not client input.
 */
export const copyAdaptRequestedEvent = eventType(
  "generation/copy.adapt.requested",
  {
    schema: z.object({
      orgId: z.string(),
      jobId: z.string(),
      brandId: z.string(),
      // Cost of adapting ONE platform; total reserved = this × platforms.length.
      creditsPerPlatform: z.number().int(),
      modelId: z.string(),
      platforms: z.array(postPlatformSchema),
      sourceCaption: z.string(),
      voiceProfile: voiceProfileEventSchema,
    }),
  },
);
