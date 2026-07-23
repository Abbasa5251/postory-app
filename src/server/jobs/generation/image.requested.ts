import "server-only";
import { getSystemCtx } from "@/server/auth/context";
import { imageChannel } from "@/lib/realtime/image-channel";
import {
  getBalance,
  outstandingReservation,
  refundCredits,
  reserveCredits,
} from "@/server/dal/credits";
import { completeJob, getById, startJob } from "@/server/dal/generation-jobs";
import { recordGeneratedAsset, setModerationStatus } from "@/server/dal/media";
import {
  assertSufficientBalance,
  refundOnSettle,
} from "@/server/domain/credits";
import { buildImagePrompt } from "@/server/domain/image-prompt";
import { verdictFromJudge } from "@/server/domain/moderation";
import { generateImages, moderateImage } from "@/server/services/openrouter";
import {
  buildMediaKey,
  extForMediaType,
  publicUrl,
  putObject,
} from "@/server/services/storage";
import { inngest } from "../client";
import { imageRequestedEvent } from "../events";

const JOB_NAME = "generation/image.requested";

/**
 * A generated image the client can attach — the composer's MediaAssetView
 * shape, matching the imageChannel `asset` schema.
 */
type GeneratedAssetView = {
  id: string;
  kind: "image";
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  moderationStatus: string;
};

/**
 * AI image generation (D2, ADR-003/-005/-007/-012). Reserve N credits (one per
 * variant) BEFORE the first OpenRouter call (§8), generate each variant in
 * parallel (one memoized step each so retries never re-charge or re-generate a
 * completed variant), store the base64 bytes in R2, record a
 * `media_assets` row (`source='generated'`), then settle: charge only the
 * variants that succeeded and refund the rest (failed generations are unbilled
 * by OpenRouter → refund, ADR-012). A single variant's failure is caught in-band
 * (partial success) and does NOT fail the whole job. `onFailure` is the crash
 * safety-net: it refunds the LEDGER-derived remaining reservation exactly once
 * (idempotent — a re-run recomputes 0), mirroring C2/C3. The DB-level
 * partial-unique guard on the refund row is deferred to H4 (needs a migration).
 *
 * D5 output moderation: each generated variant is judged (OpenRouter vision
 * model) inside its variant step and its moderation_status flipped from
 * 'pending' to 'passed' / 'blocked'. A block does NOT refund — the generation
 * succeeded and OpenRouter billed us (founder call: charge the editor for an
 * unsafe generation), so a blocked variant is still counted in `produced` and
 * charged; it simply streams back flagged and the UI won't let it be attached.
 * Moderation is FAIL-CLOSED: any judge/DB error marks the variant blocked, never
 * silently passed. (The prompt gate ran in the action, before any spend.)
 */
export const generateImageJob = inngest.createFunction(
  {
    id: "generation-image",
    retries: 1,
    concurrency: { key: "event.data.orgId", limit: 3 },
    triggers: [imageRequestedEvent],
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
          error: "image generation failed",
        });
        return true;
      });
      if (finalized) {
        await step.realtime.publish(
          "publish-error",
          imageChannel(d.jobId).error,
          { message: "Image generation failed — your credits were refunded." },
        );
      }
    },
  },
  async ({ event, step }) => {
    const d = event.data;
    const ctx = getSystemCtx(d.orgId, JOB_NAME);
    const total = d.creditsPerImage * d.variantCount;

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

    // Assemble the final prompt once (pure) — the same prompt seeds every
    // variant; diversity comes from the model, not the prompt (domain/image-prompt).
    const prompt = buildImagePrompt({
      prompt: d.prompt,
      brandStyle: d.voiceProfile,
      platform: d.platform,
    });

    // Generate each variant independently and in parallel. One memoized step per
    // variant → a function retry never re-generates a completed variant. Any
    // failure in the step (OpenRouter error, storage/record failure) is caught
    // here (partial success): that variant's credit is refunded at settle. A
    // generated-but-not-stored image is a rare orphan (D4 cleanup) — we still
    // refund since the asset never became usable.
    const results = await Promise.all(
      Array.from({ length: d.variantCount }, (_unused, i) => i).map((index) =>
        step.run(`variant-${index}`, async () => {
          let asset: GeneratedAssetView;
          let providerId: string | null = null;
          try {
            const [image] = await generateImages({
              modelId: d.modelId,
              prompt,
              aspectRatio: d.aspectRatio,
              n: 1,
            });
            if (!image)
              return { ok: false as const, error: "no image returned" };
            providerId = image.providerId;

            const key = buildMediaKey(
              ctx.orgId,
              d.brandId,
              extForMediaType(image.mediaType),
            );
            await putObject(key, image.bytes, image.mediaType);
            const recorded = await recordGeneratedAsset(ctx, {
              brandId: d.brandId,
              r2Key: key,
              mimeType: image.mediaType,
              sizeBytes: image.bytes.byteLength,
              // Authoritative pixel dims come from the D5 server probe; the
              // chosen aspect ratio is honored by the model. Null here, like C4.
              width: null,
              height: null,
              sourceModel: d.modelId,
              generationJobId: d.jobId,
            });

            // D5 output moderation — judge the bytes we just stored (they're in
            // scope, so no R2 re-fetch), then flip the row's moderation_status.
            // FAIL-CLOSED and fully self-contained: a judge/DB error becomes a
            // 'blocked' verdict and never escapes to the outer catch (which would
            // wrongly refund a variant OpenRouter already billed us for). The
            // generation itself already succeeded above, so no retry re-bills.
            let moderationStatus: "passed" | "blocked" = "blocked";
            try {
              const raw = await moderateImage({
                modelId: d.moderationModelId,
                bytes: image.bytes,
                mediaType: image.mediaType,
              });
              const verdict = verdictFromJudge(raw);
              moderationStatus = verdict.status;
              await setModerationStatus(ctx, recorded.id, verdict.status, {
                reason: verdict.reason,
                categories: raw.categories,
              });
            } catch {
              // Fail-closed: reset the local status FIRST so a failure AFTER a
              // passed verdict (e.g. setModerationStatus threw) can never leave
              // the client-facing status as 'passed'. Then record the block if we
              // can; if even that write fails the row stays 'pending', which the
              // publish gate (F) also refuses — safe by default.
              moderationStatus = "blocked";
              try {
                await setModerationStatus(ctx, recorded.id, "blocked", {
                  reason: "moderation error",
                });
              } catch {
                // Swallow — the local `blocked` status still flows to the client.
              }
            }

            asset = {
              id: recorded.id,
              kind: "image",
              url: publicUrl(key),
              mimeType: recorded.mimeType,
              sizeBytes: recorded.sizeBytes,
              width: recorded.width,
              height: recorded.height,
              durationSeconds: recorded.durationSeconds,
              moderationStatus,
            };
          } catch (err) {
            // Preserve the underlying reason (OpenRouter / storage / DAL) so the
            // job's error column reports why a variant failed, not just a count.
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
          // The asset is captured in this step's DURABLE result (returned below)
          // and re-broadcast in `done.assets`, so realtime is only the fast path.
          // The live publish is BEST-EFFORT: a delivery failure must never fail
          // the variant or refund an asset we actually produced.
          try {
            await inngest.realtime.publish(imageChannel(d.jobId).asset, asset);
          } catch {
            // Swallow — best-effort live delivery; the asset is durable above.
          }
          return { ok: true as const, asset, providerId };
        }),
      ),
    );

    const produced = results.flatMap((r) => (r.ok ? [r.asset] : []));
    const failureReasons = results.flatMap((r) => (r.ok ? [] : [r.error]));
    const failed = failureReasons.length;
    // Each variant is a separate OpenRouter generation, so the job records the
    // set of provider request ids (one per produced image) for billing
    // cross-reference — joined into the single provider_generation_id column.
    const providerIds = results.flatMap((r) =>
      r.ok && r.providerId ? [r.providerId] : [],
    );

    // Charge only the variants that succeeded; refund the rest.
    await step.run("settle", async () => {
      const used = produced.length * d.creditsPerImage;
      const refund = refundOnSettle(total, used);
      if (refund > 0)
        await refundCredits(ctx, { jobId: d.jobId, credits: refund });
      await completeJob(ctx, d.jobId, {
        status: produced.length > 0 ? "succeeded" : "failed",
        creditsSettled: used,
        providerGenerationId: providerIds.length
          ? providerIds.join(",")
          : undefined,
        error:
          failed > 0
            ? `image generation failed for ${failed} variant(s): ${[...new Set(failureReasons)].join("; ")}`
            : undefined,
      });
    });

    await step.realtime.publish("publish-done", imageChannel(d.jobId).done, {
      failed,
      assets: produced,
    });
    return { jobId: d.jobId, produced: produced.length, failed };
  },
);
