import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { approvals } from "@/db/schemas/approvals";
import { member, user } from "@/db/schemas/auth";
import { orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * approvals DAL (E1) — immutable decision records (§4/§5). This module owns the
 * READS (reviewer UI + the composer's "what to fix" note) plus a
 * `buildApprovalInsert` helper the posts-DAL transitions compose into their
 * atomic mutation+audit `db.batch` (the WRITE must be atomic with the
 * posts.status change, so it can't live as a standalone insert here).
 *
 * E1 records only the `internal` stage (member-decided). The `client` stage
 * (portal-token-decided) lands with the client portal (E4).
 */

/** An internal approval decision to record (§5 stage='internal'). */
export type InternalDecisionInput = {
  postId: string;
  /** The version the decision binds to — post.currentVersionId (§5). */
  postVersionId: string;
  decision: "approved" | "changes_requested";
  round: number;
  note?: string | null;
};

/**
 * Build (do NOT execute) the approvals insert for composition inside a
 * db.batch alongside the posts.status update + audit (dal/audit.ts Case A).
 * Attribution is the member ctx — internal decisions are always member-made
 * (approvals_decider_stage_check enforces member↔internal at the DB too).
 * org_id comes from ctx, never input.
 */
export function buildApprovalInsert(
  ctx: AuthCtx,
  input: InternalDecisionInput,
) {
  return db.insert(approvals).values({
    orgId: ctx.orgId,
    postId: input.postId,
    postVersionId: input.postVersionId,
    stage: "internal",
    round: input.round,
    decision: input.decision,
    note: input.note ?? null,
    decidedByMemberId: ctx.role === "system" ? null : ctx.memberId,
  });
}

/**
 * The round number for the next internal decision on a post: prior internal
 * decisions + 1 (starts at 1). Monotonic ordering of review passes — org-scoped
 * pre-read, run before the transition's atomic batch (advisory, not a tenancy
 * invariant).
 */
export async function nextInternalRound(
  ctx: AuthCtx,
  postId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(approvals)
    .where(
      and(
        orgScope(ctx, approvals),
        eq(approvals.postId, postId),
        eq(approvals.stage, "internal"),
      ),
    );
  return (row?.n ?? 0) + 1;
}

export type ApprovalRecord = {
  id: string;
  stage: string;
  decision: string;
  round: number;
  note: string | null;
  decidedAt: Date;
  decidedByName: string | null;
};

/**
 * A post's decision history, newest first (org-scoped). Powers the reviewer UI
 * and the composer's latest-note banner. Joins the deciding member → user for a
 * display name (mirrors listOrgMembers); nullable so history survives a removed
 * member (approvals.decided_by_member_id is SET NULL).
 */
export async function listApprovalsForPost(
  ctx: AuthCtx,
  postId: string,
): Promise<ApprovalRecord[]> {
  return db
    .select({
      id: approvals.id,
      stage: approvals.stage,
      decision: approvals.decision,
      round: approvals.round,
      note: approvals.note,
      decidedAt: approvals.decidedAt,
      decidedByName: user.name,
    })
    .from(approvals)
    .leftJoin(member, eq(member.id, approvals.decidedByMemberId))
    .leftJoin(user, eq(user.id, member.userId))
    .where(and(orgScope(ctx, approvals), eq(approvals.postId, postId)))
    .orderBy(desc(approvals.decidedAt));
}
