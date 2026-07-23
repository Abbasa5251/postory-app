import "server-only";
import { getSystemCtx } from "@/server/auth/context";
import {
  deleteMediaAsset,
  findOrphanGeneratedAssets,
} from "@/server/dal/media";
import { listOrgIdsForSweep } from "@/server/dal/org";
import { NotFoundError } from "@/server/domain/errors";
import { log } from "@/server/services/observability";
import { deleteObject } from "@/server/services/storage";
import { inngest } from "../client";

const JOB_NAME = "media/orphan.cleanup";

/** Grace window: an AI-generated asset must be unreferenced for this long
 * before the sweep removes it, so a just-generated-but-not-yet-attached variant
 * is never nuked out from under the composer. */
const GRACE_DAYS = 30;

/** Per-org, per-run cap — bounds one sweep so a huge backlog can't build an
 * unbounded step (the next weekly run continues where this left off). */
const PER_ORG_LIMIT = 200;

/**
 * Orphaned-media cleanup (D4, AGENTS.md §10 — the FIRST scheduled/cron Inngest
 * function in the repo; establishes the pattern, so future sweeps join the §10
 * registry rather than reinvent it). Weekly it removes AI-generated assets that
 * no post version references (e.g. unpicked generation variants) once they are
 * past a 30-day grace window, along with their R2 objects. Uploads are never
 * touched (user-deliberate).
 *
 * Cross-org by necessity: a cron has no org payload, so it enumerates orgs via
 * the one deliberately un-scoped DAL read (`listOrgIdsForSweep`, §13 hotspot),
 * then runs the ORDINARY org-scoped media DAL under a per-org system ctx — no
 * tenant data ever leaves its org (§6).
 *
 * Idempotent + retry-safe: each org is its own memoized `step.run`, and delete
 * works off a fresh orphan query, so a retry re-finds only what's still present
 * (already-deleted rows are gone). `deleteObject` is best-effort (a stray object
 * is harmless); a benign delete race (row already gone) is skipped, not fatal.
 * Per-org failure isolation: a failing org is caught + logged inside its step
 * and the sweep continues, so one bad tenant can't abort the run (the next
 * weekly run retries it).
 */
export const orphanMediaCleanupJob = inngest.createFunction(
  {
    id: "media-orphan-cleanup",
    retries: 1,
    // One sweep at a time — weekly runs never overlap in practice, but guard it.
    concurrency: { limit: 1 },
    triggers: [{ cron: "TZ=Etc/UTC 0 3 * * 0" }],
  },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
    const orgIds = await step.run("list-orgs", () => listOrgIdsForSweep());

    let deletedTotal = 0;
    for (const orgId of orgIds) {
      const deleted = await step.run(`sweep-${orgId}`, async () => {
        const ctx = getSystemCtx(orgId, JOB_NAME);
        let count = 0;
        try {
          const orphans = await findOrphanGeneratedAssets(ctx, {
            olderThan: cutoff,
            limit: PER_ORG_LIMIT,
          });
          for (const orphan of orphans) {
            let r2Key: string;
            try {
              ({ r2Key } = await deleteMediaAsset(ctx, orphan.id));
            } catch (error) {
              // Row already gone (raced with a manual delete) — benign, skip it.
              // Any other error bubbles to the per-org catch below.
              if (error instanceof NotFoundError) continue;
              throw error;
            }
            try {
              await deleteObject(r2Key);
            } catch (error) {
              // The row is gone; a stray object is harmless. Log and move on so
              // a single storage miss can't strand the rest of the sweep.
              log.warn("orphan media object not removed", {
                event: "media.orphan_cleanup.object_orphaned",
                orgId,
                mediaId: orphan.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            count += 1;
          }
        } catch (error) {
          // Isolate the org: a failure here (the orphan query, or a non-benign
          // delete error) is logged and the sweep moves on so one bad tenant
          // can't abort the rest of the run. The next weekly run retries it
          // (the sweep is idempotent); `count` reflects any deletions that did
          // land before the failure.
          log.error("orphan media cleanup failed for org", {
            event: "media.orphan_cleanup.org_failed",
            orgId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return count;
      });
      deletedTotal += deleted;
    }

    log.info("orphan media cleanup complete", {
      event: "media.orphan_cleanup",
      orgs: orgIds.length,
      deleted: deletedTotal,
    });
    return { orgs: orgIds.length, deleted: deletedTotal };
  },
);
