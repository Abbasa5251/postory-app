"use server";

import { getClientSubscriptionToken } from "inngest/react";
import { imageChannel } from "@/lib/realtime/image-channel";
import { voiceProfileSchema } from "@/lib/validation/brands";
import { generateImageSchema } from "@/lib/validation/image";
import { getBrandById } from "@/server/dal/brands";
import { getActiveRate, getBalance } from "@/server/dal/credits";
import { createJob } from "@/server/dal/generation-jobs";
import { assertSufficientBalance } from "@/server/domain/credits";
import { ModerationError } from "@/server/domain/errors";
import { screenPrompt } from "@/server/domain/moderation";
import { inngest } from "@/server/jobs/client";
import { imageRequestedEvent } from "@/server/jobs/events";
import { withAction } from "./with-action";

/**
 * Validate a brand's stored voice profile through its schema rather than
 * trusting the jsonb column shape — null (no guidance) if absent or unparseable.
 * Mirrors the copy action's `parseStoredVoice`.
 */
function parseStoredVoice(voiceProfile: unknown) {
  const parsed = voiceProfileSchema.nullable().safeParse(voiceProfile ?? null);
  return parsed.success ? parsed.data : null;
}

/**
 * AI image generation (D2/D3). Enqueue-only per ADR-003, same pipeline as the
 * copy actions: validate → authorize ("ai:generate") → §7 scoped fetch →
 * fast-fail the balance for ALL variants → create the queued job → send the
 * Inngest event → return the jobId + a realtime subscription token. The worker
 * reserves N credits (1 per variant), generates each via OpenRouter's Image API,
 * stores it in R2, and settles / refunds failed variants.
 *
 * The tier (standard | premium) maps to the credit_rates action
 * (`image_standard` | `image_premium`) — the model id + per-image price come
 * from config (ADR-012), never hardcoded or client-supplied. Cost is that
 * per-image rate × variantCount (a separate OpenRouter call per variant).
 *
 * The subscription token is scoped to THIS just-created job's channel, so it
 * can't read another org's stream.
 */
export const generateImage = withAction(
  generateImageSchema,
  "ai:generate",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch (cross-org / unassigned brand 404s here). Also
    // yields the brand voice profile that seasons the prompt (B2).
    const brand = await getBrandById(ctx, data.brandId);

    // D5 prompt gate (deterministic, free, fail-fast): a blocked prompt never
    // generates anything, so nothing is reserved or charged. Output moderation
    // (the judge on each generated image) runs in the worker.
    if (screenPrompt(data.prompt).blocked) throw new ModerationError();

    // Tier → credit_rates action; model id + per-image price from config.
    const rate = await getActiveRate(
      data.tier === "premium" ? "image_premium" : "image_standard",
    );
    // D5: resolve the moderation judge model up front — a missing 'moderation'
    // rate throws NOT_FOUND here (nothing generated/charged) rather than
    // blocking-after-billing in the worker.
    const moderationRate = await getActiveRate("moderation");
    const total = rate.credits * data.variantCount;
    // Fast-fail the whole batch so the UI shows INSUFFICIENT_CREDITS without
    // spinning up a job; the worker re-checks + reserves (authoritative, §8).
    assertSufficientBalance(await getBalance(ctx), total);

    const { id: jobId } = await createJob(ctx, {
      brandId: data.brandId,
      type: "image",
      modelId: rate.modelId,
      prompt: data.prompt,
      params: {
        tier: data.tier,
        aspectRatio: data.aspectRatio,
        variantCount: data.variantCount,
        platform: data.platform,
      },
    });

    const voiceProfile = parseStoredVoice(brand.voiceProfile);

    await inngest.send(
      imageRequestedEvent.create(
        {
          orgId: ctx.orgId,
          jobId,
          brandId: data.brandId,
          creditsPerImage: rate.credits,
          modelId: rate.modelId,
          moderationModelId: moderationRate.modelId,
          prompt: data.prompt,
          aspectRatio: data.aspectRatio,
          variantCount: data.variantCount,
          voiceProfile,
          platform: data.platform,
        },
        // Idempotency: the event id is the (unique-per-call) job id, so a
        // retried send within the dedupe window can't spawn a duplicate run.
        { id: jobId },
      ),
    );

    const token = await getClientSubscriptionToken(inngest, {
      channel: imageChannel(jobId),
      topics: ["asset", "done", "error"],
    });

    return { jobId, token };
  },
);
