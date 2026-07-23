import "server-only";
import { getSystemCtx } from "@/server/auth/context";
import { copyChannel } from "@/lib/realtime/copy-channel";
import {
  getBalance,
  outstandingReservation,
  refundCredits,
  reserveCredits,
} from "@/server/dal/credits";
import { completeJob, getById, startJob } from "@/server/dal/generation-jobs";
import {
  assertSufficientBalance,
  refundOnSettle,
} from "@/server/domain/credits";
import { buildCopyPrompt, parseVariants } from "@/server/domain/copy-prompt";
import { streamCaption } from "@/server/services/openrouter";
import { inngest } from "../client";
import { copyRequestedEvent } from "../events";

const JOB_NAME = "generation/copy.requested";

/**
 * AI copy generation (C2, ADR-003/-005/-012). Reserve credits BEFORE the
 * OpenRouter call (§8, non-negotiable) → stream the batch, forwarding token
 * deltas to the realtime channel → settle. On failure, `onFailure` refunds the
 * reservation exactly once (OpenRouter doesn't bill failures, ADR-012).
 *
 * Concurrency is keyed per org so an org's generations serialize a few at a
 * time — this bounds the reserve→spend race (H4 adds a materialized balance).
 * Steps are separated so each memoizes independently: a retry never re-runs a
 * completed reserve (which would double-debit).
 */
export const generateCopyJob = inngest.createFunction(
  {
    id: "generation-copy",
    retries: 1,
    concurrency: { key: "event.data.orgId", limit: 3 },
    triggers: [copyRequestedEvent],
    // Settles a job's refund at most once, three ways: (1) the event id is the
    // jobId, so Inngest runs one function per job — no concurrent onFailure;
    // (2) onFailure fires once after retries and this step.run is memoized;
    // (3) the amount is the LEDGER-derived remaining balance
    // (outstandingReservation), not job.creditsReserved — so a re-run (even one
    // that crashed between refund and completeJob) recomputes 0 and
    // refundCredits no-ops. This also refunds a reserve that completed before
    // `start` set creditsReserved. A DB-level partial-unique guard on the refund
    // row is the belt-and-suspenders, deferred to H4's credit hardening (needs a
    // migration, ships alone per §12). Skips an already-finalized job.
    onFailure: async ({ event, step }) => {
      const d = event.data.event.data;
      const ctx = getSystemCtx(d.orgId, JOB_NAME);
      const finalized = await step.run("refund-on-failure", async () => {
        const job = await getById(ctx, d.jobId);
        if (job.status === "succeeded" || job.status === "failed") return false;
        const owed = await outstandingReservation(ctx, d.jobId);
        await refundCredits(ctx, { jobId: d.jobId, credits: owed });
        await completeJob(ctx, d.jobId, {
          status: "failed",
          creditsSettled: 0,
          error: "generation failed",
        });
        return true;
      });
      // Only tell the client it failed when we actually transitioned it to
      // failed — never contradict an already-succeeded run.
      if (finalized) {
        await step.realtime.publish(
          "publish-error",
          copyChannel(d.jobId).error,
          { message: "Generation failed — your credits were refunded." },
        );
      }
    },
  },
  async ({ event, step }) => {
    const d = event.data;
    const ctx = getSystemCtx(d.orgId, JOB_NAME);

    // Reserve BEFORE the OpenRouter call (§8). Balance was fast-checked in the
    // action; re-check here (the authoritative guard) so a drained balance
    // between enqueue and run can't overspend.
    await step.run("reserve", async () => {
      const balance = await getBalance(ctx);
      assertSufficientBalance(balance, d.credits);
      await reserveCredits(ctx, { jobId: d.jobId, credits: d.credits });
    });
    await step.run("start", () =>
      startJob(ctx, d.jobId, { creditsReserved: d.credits }),
    );

    const generated = await step.run("generate", async () => {
      const { system, prompt } = buildCopyPrompt({
        platform: d.platform,
        brief: d.brief,
        voiceProfile: d.voiceProfile,
        variantCount: d.variantCount,
        refineFrom: d.refineFrom,
        instruction: d.instruction,
      });
      const { textStream, text, providerId } = streamCaption({
        modelId: d.modelId,
        system,
        prompt,
      });
      // Inside a step → the bare client publish (no step-in-step wrapping).
      for await (const delta of textStream) {
        await inngest.realtime.publish(copyChannel(d.jobId).chunk, {
          text: delta,
        });
      }
      return { text: await text, providerId: await providerId };
    });

    const variants = parseVariants(generated.text, d.variantCount);

    // Copy is fixed-cost: used === reserved on success, so the settle refund is
    // 0. The refundOnSettle seam is what D2's variable image cost will use.
    await step.run("settle", async () => {
      const refund = refundOnSettle(d.credits, d.credits);
      if (refund > 0)
        await refundCredits(ctx, { jobId: d.jobId, credits: refund });
      await completeJob(ctx, d.jobId, {
        status: "succeeded",
        creditsSettled: d.credits - refund,
        providerGenerationId: generated.providerId ?? undefined,
      });
    });

    await step.realtime.publish("publish-done", copyChannel(d.jobId).done, {
      variants,
    });
    return { jobId: d.jobId, variants: variants.length };
  },
);
