import "server-only";
import { getSystemCtx } from "@/server/auth/context";
import { adaptChannel } from "@/lib/realtime/adapt-channel";
import {
  getBalance,
  outstandingReservation,
  refundCredits,
  reserveCredits,
} from "@/server/dal/credits";
import { recordAuditEvent } from "@/server/dal/audit";
import { completeJob, getById, startJob } from "@/server/dal/generation-jobs";
import {
  assertSufficientBalance,
  refundOnSettle,
} from "@/server/domain/credits";
import { buildAdaptPrompt } from "@/server/domain/copy-prompt";
import { verdictFromJudge } from "@/server/domain/moderation";
import { moderateText, streamCaption } from "@/server/services/openrouter";
import { inngest } from "../client";
import { copyAdaptRequestedEvent } from "../events";

const JOB_NAME = "generation/copy.adapt.requested";

/**
 * AI cross-platform adaptation (C3, ADR-003/-005/-012). "Write once → per
 * platform": one master caption is adapted into a native version for each
 * target platform via a separate OpenRouter call (1 credit each, PRD §7.2).
 *
 * Reserve the full N credits BEFORE the first OpenRouter call (§8), adapt each
 * platform in parallel (one memoized step each so retries never re-charge or
 * re-call a completed platform), then settle: charge only the platforms that
 * succeeded and refund the rest. A single platform's failure is caught in-band
 * (partial success) — it does NOT fail the whole job. `onFailure` is the crash
 * safety-net: it refunds the LEDGER-derived remaining reservation exactly once
 * (idempotent — a re-run recomputes 0), mirroring C2's copy job. The DB-level
 * partial-unique guard on the refund row is deferred to H4 (needs a migration).
 */
export const adaptCopyJob = inngest.createFunction(
  {
    id: "generation-copy-adapt",
    retries: 1,
    concurrency: { key: "event.data.orgId", limit: 3 },
    triggers: [copyAdaptRequestedEvent],
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
          error: "adaptation failed",
        });
        return true;
      });
      if (finalized) {
        await step.realtime.publish(
          "publish-error",
          adaptChannel(d.jobId).error,
          { message: "Adaptation failed — your credits were refunded." },
        );
      }
    },
  },
  async ({ event, step }) => {
    const d = event.data;
    const ctx = getSystemCtx(d.orgId, JOB_NAME);
    const total = d.creditsPerPlatform * d.platforms.length;

    // Reserve the full N credits BEFORE any OpenRouter call (§8). Balance was
    // fast-checked in the action; re-check here (authoritative) so a balance
    // drained between enqueue and run can't overspend.
    await step.run("reserve", async () => {
      const balance = await getBalance(ctx);
      assertSufficientBalance(balance, total);
      await reserveCredits(ctx, { jobId: d.jobId, credits: total });
    });
    await step.run("start", () =>
      startJob(ctx, d.jobId, { creditsReserved: total }),
    );

    // Adapt each platform independently and in parallel. One memoized step per
    // platform → a function retry never re-calls a completed platform. A single
    // platform's OpenRouter failure is caught here (partial success), so it
    // doesn't throw the whole job into onFailure.
    const results = await Promise.all(
      d.platforms.map((platform) =>
        step.run(`adapt-${platform}`, async () => {
          // Generate + trim. A genuine failure here (OpenRouter error, empty
          // response, etc.) marks the platform unsuccessful → its credit is
          // refunded at settle and it's reported in `failed`.
          let caption: string;
          let providerId: string | null = null;
          try {
            const { system, prompt } = buildAdaptPrompt({
              platform,
              sourceCaption: d.sourceCaption,
              voiceProfile: d.voiceProfile,
            });
            const { text, providerId: pid } = streamCaption({
              modelId: d.modelId,
              system,
              prompt,
            });
            caption = (await text).trim();
            providerId = await pid;
          } catch {
            return { platform, outcome: "failed" as const };
          }

          // D5 output moderation (fail-closed → blocked). A blocked caption is
          // NOT published and never fills its tab, but it WAS generated + billed
          // → it's charged, not refunded (unlike a generation failure). Block +
          // log (§ audit metadata never carries the flagged text).
          let blocked = false;
          try {
            const raw = await moderateText({
              modelId: d.moderationModelId,
              text: caption,
            });
            blocked = verdictFromJudge(raw).status === "blocked";
          } catch {
            blocked = true;
          }
          if (blocked) {
            await recordAuditEvent(ctx, {
              action: "moderation.block",
              entityType: "generation_job",
              entityId: d.jobId,
              metadata: { contentType: "copy_adapt", platform },
            });
            return { platform, outcome: "blocked" as const, providerId };
          }

          // The caption is now captured in this step's DURABLE result (returned
          // below) and re-broadcast in the `done` payload, so realtime is only
          // the fast path. The live publish is therefore BEST-EFFORT: a delivery
          // failure must never fail the platform or refund a caption we actually
          // produced — the client falls back to `done.captions`.
          try {
            await inngest.realtime.publish(adaptChannel(d.jobId).adapted, {
              platform,
              caption,
            });
          } catch {
            // Swallow — best-effort live delivery; the caption is durable above.
          }
          return {
            platform,
            outcome: "passed" as const,
            caption,
            providerId,
          };
        }),
      ),
    );

    // Everything that generated (passed OR blocked) was billed by OpenRouter →
    // charged; only genuine generation failures are refunded (§8, founder call).
    const generated = results.filter((r) => r.outcome !== "failed");
    const failed = results
      .filter((r) => r.outcome === "failed")
      .map((r) => r.platform);
    const blocked = results
      .filter((r) => r.outcome === "blocked")
      .map((r) => r.platform);
    // Only PASSED captions are applied to tabs / re-broadcast in `done`.
    const captions = results.flatMap((r) =>
      r.outcome === "passed"
        ? [{ platform: r.platform, caption: r.caption }]
        : [],
    );
    // One OpenRouter generation per generated platform → record the set of
    // provider ids (joined) for billing cross-reference, like the image job.
    const providerIds = results.flatMap((r) =>
      r.outcome !== "failed" && r.providerId ? [r.providerId] : [],
    );

    // Charge every generated platform (passed + blocked); refund only failures.
    await step.run("settle", async () => {
      const used = generated.length * d.creditsPerPlatform;
      const refund = refundOnSettle(total, used);
      if (refund > 0)
        await refundCredits(ctx, { jobId: d.jobId, credits: refund });
      await completeJob(ctx, d.jobId, {
        status: generated.length > 0 ? "succeeded" : "failed",
        creditsSettled: used,
        providerGenerationId: providerIds.length
          ? providerIds.join(",")
          : undefined,
        error:
          [
            failed.length > 0
              ? `adaptation failed for: ${failed.join(", ")}`
              : null,
            blocked.length > 0
              ? `blocked by moderation: ${blocked.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("; ") || undefined,
      });
    });

    await step.realtime.publish("publish-done", adaptChannel(d.jobId).done, {
      failed,
      blocked,
      captions,
    });
    return {
      jobId: d.jobId,
      adapted: captions.length,
      failed: failed.length,
      blocked: blocked.length,
    };
  },
);
