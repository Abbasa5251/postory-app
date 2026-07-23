"use server";

import { getClientSubscriptionToken } from "inngest/react";
import { adaptChannel } from "@/lib/realtime/adapt-channel";
import { copyChannel } from "@/lib/realtime/copy-channel";
import { voiceProfileSchema } from "@/lib/validation/brands";
import { adaptCopySchema, generateCopySchema } from "@/lib/validation/copy";
import { getBrandById } from "@/server/dal/brands";
import { getActiveRate, getBalance } from "@/server/dal/credits";
import { createJob } from "@/server/dal/generation-jobs";
import { assertSufficientBalance } from "@/server/domain/credits";
import { ModerationError } from "@/server/domain/errors";
import { screenPrompt } from "@/server/domain/moderation";
import { inngest } from "@/server/jobs/client";
import {
  copyAdaptRequestedEvent,
  copyRequestedEvent,
} from "@/server/jobs/events";
import { withAction } from "./with-action";

/**
 * Validate a brand's stored voice profile through its schema rather than
 * trusting the jsonb column shape — null (no guidance) if absent or unparseable.
 * Shared by the copy + adapt actions so both send the AI the same normalized voice.
 */
function parseStoredVoice(voiceProfile: unknown) {
  const parsed = voiceProfileSchema.nullable().safeParse(voiceProfile ?? null);
  return parsed.success ? parsed.data : null;
}

/**
 * AI copy generation (C2). Enqueue-only per ADR-003: validate → authorize
 * ("ai:generate") → §7 scoped fetch → fast-fail the balance → create the
 * queued job → send the Inngest event → return the jobId + a realtime
 * subscription token. The actual OpenRouter call, credit reserve, and
 * settle/refund all happen in the worker (jobs/generation/copy.requested).
 *
 * The subscription token is scoped to THIS just-created job's channel, so it
 * can't be used to read another org's stream (the only place a token is minted
 * is here, for a job the caller owns).
 */
export const generateCopy = withAction(
  generateCopySchema,
  "ai:generate",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch (cross-org / unassigned brand 404s here). Also
    // yields the brand voice profile that shapes the prompt (B2).
    const brand = await getBrandById(ctx, data.brandId);

    // D5 prompt gate (deterministic, fail-fast) on the brief + any refine
    // instruction — a blocked prompt never generates anything (nothing spent).
    // Output moderation on the generated captions runs in the worker.
    if (screenPrompt(`${data.brief}\n${data.instruction ?? ""}`).blocked)
      throw new ModerationError();

    // Model id + price from config (ADR-012), never hardcoded / client-supplied.
    const rate = await getActiveRate("copy");
    // D5: resolve the moderation judge model up front (missing config → NOT_FOUND
    // here, nothing generated/charged, vs blocking-after-billing in the worker).
    const moderationRate = await getActiveRate("moderation");
    // Fast-fail so the UI shows INSUFFICIENT_CREDITS without spinning up a job;
    // the worker re-checks + reserves (the authoritative guard, §8).
    assertSufficientBalance(await getBalance(ctx), rate.credits);

    const { id: jobId } = await createJob(ctx, {
      brandId: data.brandId,
      type: "copy",
      modelId: rate.modelId,
      prompt: data.brief,
      params: {
        platform: data.platform,
        variantCount: data.variantCount,
        refine: data.refineFrom !== undefined,
      },
    });

    const voiceProfile = parseStoredVoice(brand.voiceProfile);

    await inngest.send(
      copyRequestedEvent.create(
        {
          orgId: ctx.orgId,
          jobId,
          brandId: data.brandId,
          credits: rate.credits,
          modelId: rate.modelId,
          moderationModelId: moderationRate.modelId,
          platform: data.platform,
          brief: data.brief,
          voiceProfile,
          variantCount: data.variantCount,
          refineFrom: data.refineFrom,
          instruction: data.instruction,
        },
        // Idempotency: the event id is the (unique-per-call) job id, so a
        // retried send within the dedupe window can't spawn a duplicate run.
        { id: jobId },
      ),
    );

    const token = await getClientSubscriptionToken(inngest, {
      channel: copyChannel(jobId),
      topics: ["chunk", "done", "error"],
    });

    return { jobId, token };
  },
);

/**
 * AI cross-platform adaptation (C3 — "write once → per-platform"). Enqueue-only
 * per ADR-003, same pipeline as generateCopy: validate → authorize
 * ("ai:generate") → §7 scoped fetch → fast-fail the balance for ALL targets →
 * create the queued job → send the Inngest event → return the jobId + a
 * realtime subscription token. The worker reserves N credits (1 per target),
 * adapts each platform via OpenRouter, and settles / refunds failed platforms.
 *
 * Cost is 1 credit per target platform (a separate OpenRouter call each), so
 * the reserved total is the config "copy" rate × the number of targets — no new
 * credit_rates row (the per-platform cost is the multiply, not a new action).
 */
export const adaptCopy = withAction(
  adaptCopySchema,
  "ai:generate",
  async (data, ctx) => {
    // §7 step 4 — scoped fetch (cross-org / unassigned brand 404s here). Also
    // yields the brand voice profile that shapes each adaptation (B2).
    const brand = await getBrandById(ctx, data.brandId);

    // D5 prompt gate (deterministic, fail-fast) on the source caption.
    if (screenPrompt(data.sourceCaption).blocked) throw new ModerationError();

    const rate = await getActiveRate("copy");
    // D5: resolve the moderation judge model up front (see generateCopy).
    const moderationRate = await getActiveRate("moderation");
    const total = rate.credits * data.platforms.length;
    // Fast-fail the whole batch so the UI shows INSUFFICIENT_CREDITS without
    // spinning up a job; the worker re-checks + reserves (authoritative, §8).
    assertSufficientBalance(await getBalance(ctx), total);

    const { id: jobId } = await createJob(ctx, {
      brandId: data.brandId,
      type: "copy",
      modelId: rate.modelId,
      prompt: data.sourceCaption,
      params: { platforms: data.platforms, adapt: true },
    });

    const voiceProfile = parseStoredVoice(brand.voiceProfile);

    await inngest.send(
      copyAdaptRequestedEvent.create(
        {
          orgId: ctx.orgId,
          jobId,
          brandId: data.brandId,
          creditsPerPlatform: rate.credits,
          modelId: rate.modelId,
          moderationModelId: moderationRate.modelId,
          platforms: data.platforms,
          sourceCaption: data.sourceCaption,
          voiceProfile,
        },
        // Idempotency: the event id is the (unique-per-call) job id, so a
        // retried send within the dedupe window can't spawn a duplicate run.
        { id: jobId },
      ),
    );

    const token = await getClientSubscriptionToken(inngest, {
      channel: adaptChannel(jobId),
      topics: ["adapted", "done", "error"],
    });

    return { jobId, token };
  },
);
