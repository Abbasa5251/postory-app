import "server-only";
import { db } from "@/db/db";
import { auditLog } from "@/db/schemas/audit";
import {
  authAuditEventSchema,
  orgAuditEventSchema,
  type AuthAuditEvent,
  type OrgAuditEvent,
} from "@/lib/validation/audit";
import type { AuthCtx } from "./types";

/**
 * Auth-event audit writer (ADR-011 login audit events).
 *
 * Takes NO `AuthCtx` by design: auth events (sign-in, sign-up, password
 * reset) occur before or without an active organization, so there is no
 * tenancy context to scope by — `actor_type` is `user` and `org_id` is
 * whatever the session carries (usually null). Org-scoped mutations get the
 * separate `recordAuditEvent(ctx: AuthCtx, ...)` API when the DAL lands (A5)
 * — do NOT widen this function to cover them.
 *
 * Never throws: a failed audit insert must not break sign-in, and this is
 * called from better-auth hooks with no error boundary of ours above it.
 * (Sentry capture lands with A6.)
 */
export async function recordAuthEvent(input: AuthAuditEvent): Promise<void> {
  try {
    const event = authAuditEventSchema.parse(input);
    await db.insert(auditLog).values({
      orgId: event.orgId ?? null,
      actorType: "user",
      actorId: event.userId ?? null,
      action: event.action,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      metadata: event.metadata ?? null,
    });
  } catch (error) {
    console.error("[audit] failed to record auth event", error);
  }
}

/**
 * Org-scoped mutation audit (AGENTS.md §6.6) — every mutating DAL method
 * pairs with one of these. Tenancy and attribution come from the ctx, never
 * the event: MemberCtx → ('member', memberId), SystemCtx → ('system',
 * jobName).
 *
 * FAIL-CLOSED, the deliberate opposite of recordAuthEvent's fail-open: a
 * mutation without an audit row is a §6.6 contract violation, the caller is
 * a server action WITH an error boundary above it, and silently swallowing
 * the failure would mean tenant data changed with no trace.
 *
 * # The mutation+audit atomicity template (drizzle-orm/node-postgres)
 *
 * node-postgres supports real interactive transactions, so a mutation and its
 * audit row commit-or-roll-back together inside db.transaction(). Pass the `tx`
 * handle to buildAuditInsert so the audit insert joins the same transaction;
 * omit it and the insert runs on the module `db`, OUTSIDE the tx — a
 * correctness bug.
 *
 * (Historical note: under the old neon-http driver db.transaction() threw and
 * db.batch() was the atomic primitive, but its statements were built up-front
 * and committed unconditionally — so a raced 0-row update left a no-op audit
 * orphan. Interactive transactions remove that residual: we branch on the
 * mutation's result BEFORE writing the audit row.)
 *
 * Case A — entity id known before execution (updates, deletes, state
 * transitions — the common case):
 *
 *   return await db.transaction(async (tx) => {
 *     const updated = await tx.update(posts).set(next)
 *       .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
 *       .returning({ id: posts.id });
 *     // Throw BEFORE the audit insert: rolls back with NO orphan audit row.
 *     if (updated.length === 0) throw new NotFoundError("post", postId);
 *     await buildAuditInsert(ctx, { action: "post.approve", entityType: "post", entityId: postId }, tx);
 *     return updated[0];
 *   });
 *
 * Case B — creates with a DB-generated uuidv7() id: insert, read the id from
 * returning(), then audit — all in one tx, so a failed audit rolls the create
 * back too (no manual-remediation orphan):
 *
 *   return await db.transaction(async (tx) => {
 *     const [row] = await tx.insert(brands).values({ ...data, orgId: ctx.orgId }).returning();
 *     await buildAuditInsert(ctx, { action: "brand.create", entityType: "brand", entityId: row.id }, tx);
 *     return row;
 *   });
 *
 * (High-stakes creates like credit_ledger get the same tx treatment; re-verify
 * the API against the installed drizzle in the credits PR — AGENTS.md §3.)
 */

/** A drizzle executor — the module `db`, or an interactive transaction handle. */
type AuditExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function buildAuditInsert(
  ctx: AuthCtx,
  event: OrgAuditEvent,
  executor: AuditExecutor = db,
) {
  const e = orgAuditEventSchema.parse(event);
  return executor.insert(auditLog).values({
    orgId: ctx.orgId,
    actorType: ctx.role === "system" ? "system" : "member",
    actorId: ctx.role === "system" ? ctx.jobName : ctx.memberId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    ipAddress: e.ipAddress ?? null,
    userAgent: e.userAgent ?? null,
    metadata: e.metadata ?? null,
  });
}

/**
 * Standalone executing form of buildAuditInsert, for mutations that happen
 * outside a transaction (better-auth API calls, or single-statement mutations
 * where an atomic audit isn't warranted). Throws on invalid input or a failed
 * insert.
 */
export async function recordAuditEvent(
  ctx: AuthCtx,
  event: OrgAuditEvent,
): Promise<void> {
  await buildAuditInsert(ctx, event);
}
