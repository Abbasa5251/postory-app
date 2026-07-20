"use server";

import { getClientSubscriptionToken } from "inngest/react";
import { copyChannel } from "@/lib/realtime/copy-channel";
import { voiceProfileSchema } from "@/lib/validation/brands";
import { generateCopySchema } from "@/lib/validation/copy";
import { getBrandById } from "@/server/dal/brands";
import { getActiveRate, getBalance } from "@/server/dal/credits";
import { createJob } from "@/server/dal/generation-jobs";
import { assertSufficientBalance } from "@/server/domain/credits";
import { inngest } from "@/server/jobs/client";
import { copyRequestedEvent } from "@/server/jobs/events";
import { withAction } from "./with-action";

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

    // Model id + price from config (ADR-012), never hardcoded / client-supplied.
    const rate = await getActiveRate("copy");
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

    // Validate the stored voice profile through its schema rather than trusting
    // the jsonb column shape — null (no guidance) if absent or unparseable.
    const parsedVoice = voiceProfileSchema
      .nullable()
      .safeParse(brand.voiceProfile ?? null);
    const voiceProfile = parsedVoice.success ? parsedVoice.data : null;

    await inngest.send(
      copyRequestedEvent.create(
        {
          orgId: ctx.orgId,
          jobId,
          brandId: data.brandId,
          credits: rate.credits,
          modelId: rate.modelId,
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
