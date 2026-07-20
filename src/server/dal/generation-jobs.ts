import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { generationJobs } from "@/db/schemas/media";
import { NotFoundError } from "@/server/domain/errors";
import { buildAuditInsert, recordAuditEvent } from "./audit";
import { assertBrandAccess, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Generation-jobs DAL (§13-adjacent; AGENTS.md §6, ADR-003) — one row per AI
 * generation run. Org-scoped like every module; created by the enqueue action
 * (MemberCtx) and driven through its lifecycle by the Inngest worker
 * (SystemCtx). The credit_ledger stays the source of truth for spend; the
 * reserved/settled columns here mirror it for job-level display.
 *
 * status: queued → running → succeeded | failed (| cancelled). These are
 * generation lifecycle states, NOT the post-state machine (Epic E) — a simple
 * inline flow, no shared domain module.
 */

export type GenerationType = "copy" | "image" | "video";
export type GenerationStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type GenerationJob = {
  id: string;
  brandId: string;
  type: string;
  modelId: string;
  status: string;
  creditsReserved: number;
  creditsSettled: number | null;
  providerGenerationId: string | null;
  error: string | null;
};

function actorMemberId(ctx: AuthCtx): string | null {
  return ctx.role === "system" ? null : ctx.memberId;
}

const JOB_COLUMNS = {
  id: generationJobs.id,
  brandId: generationJobs.brandId,
  type: generationJobs.type,
  modelId: generationJobs.modelId,
  status: generationJobs.status,
  creditsReserved: generationJobs.creditsReserved,
  creditsSettled: generationJobs.creditsSettled,
  providerGenerationId: generationJobs.providerGenerationId,
  error: generationJobs.error,
} as const;

/**
 * Create a queued generation job. Role is gated upstream (authorize
 * "ai:generate"); this owns tenancy + the audit pairing. org_id from ctx,
 * brand access asserted (creators 404 on unassigned brands). Case B
 * (dal/audit.ts): DB-generated uuid, so insert then audit.
 */
export async function createJob(
  ctx: AuthCtx,
  input: {
    brandId: string;
    type: GenerationType;
    modelId: string;
    prompt?: string | null;
    params?: unknown;
  },
): Promise<{ id: string }> {
  assertBrandAccess(ctx, input.brandId);
  const [row] = await db
    .insert(generationJobs)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId,
      type: input.type,
      modelId: input.modelId,
      prompt: input.prompt ?? null,
      params: input.params ?? null,
      status: "queued",
      createdBy: actorMemberId(ctx),
    })
    .returning({ id: generationJobs.id });
  if (!row) throw new Error("generation_job insert returned no row");
  await recordAuditEvent(ctx, {
    action: "generation.create",
    entityType: "generation_job",
    entityId: row.id,
    metadata: { brandId: input.brandId, type: input.type },
  });
  return { id: row.id };
}

/**
 * One job by id, org-scoped. 404-shaped for nonexistent/cross-org/unassigned
 * (AGENTS.md §7). Used for the §7 scoped fetch and job-status reads.
 */
export async function getById(
  ctx: AuthCtx,
  jobId: string,
): Promise<GenerationJob> {
  const [row] = await db
    .select(JOB_COLUMNS)
    .from(generationJobs)
    .where(and(orgScope(ctx, generationJobs), eq(generationJobs.id, jobId)))
    .limit(1);
  if (!row) throw new NotFoundError("generation_job", jobId);
  assertBrandAccess(ctx, row.brandId);
  return row;
}

/** Mark a job running and record the reserved credits. Case A (atomic + audit). */
export async function startJob(
  ctx: AuthCtx,
  jobId: string,
  input: { creditsReserved: number },
): Promise<void> {
  const [updated] = await db.batch([
    db
      .update(generationJobs)
      .set({
        status: "running",
        startedAt: new Date(),
        creditsReserved: input.creditsReserved,
      })
      .where(and(orgScope(ctx, generationJobs), eq(generationJobs.id, jobId)))
      .returning({ id: generationJobs.id }),
    buildAuditInsert(ctx, {
      action: "generation.start",
      entityType: "generation_job",
      entityId: jobId,
      metadata: { creditsReserved: input.creditsReserved },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("generation_job", jobId);
}

/**
 * Terminal transition: succeeded or failed. Records settled credits (mirrors
 * the ledger), the provider generation id, and any error. Case A (atomic +
 * audit).
 */
export async function completeJob(
  ctx: AuthCtx,
  jobId: string,
  input: {
    status: "succeeded" | "failed";
    creditsSettled: number;
    providerGenerationId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const [updated] = await db.batch([
    db
      .update(generationJobs)
      .set({
        status: input.status,
        completedAt: new Date(),
        creditsSettled: input.creditsSettled,
        providerGenerationId: input.providerGenerationId ?? null,
        error: input.error ?? null,
      })
      .where(and(orgScope(ctx, generationJobs), eq(generationJobs.id, jobId)))
      .returning({ id: generationJobs.id }),
    buildAuditInsert(ctx, {
      action: `generation.${input.status}`,
      entityType: "generation_job",
      entityId: jobId,
      metadata: { creditsSettled: input.creditsSettled },
    }),
  ]);
  if (updated.length === 0) throw new NotFoundError("generation_job", jobId);
}
