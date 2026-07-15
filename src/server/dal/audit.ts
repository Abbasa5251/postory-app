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
 * # The mutation+audit atomicity template (drizzle-orm/neon-http)
 *
 * db.transaction() THROWS on this driver; db.batch() is a real atomic
 * transaction (one Neon HTTP transaction, all-or-nothing), but statements
 * are built up-front — no statement can consume a sibling's result.
 *
 * Case A — entity id known before execution (updates, deletes, state
 * transitions — the common case). Atomic: an audit failure rolls the
 * mutation back and vice versa:
 *
 *   const [updated] = await db.batch([
 *     db.update(posts).set(next)
 *       .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
 *       .returning({ id: posts.id }),
 *     buildAuditInsert(ctx, { action: "post.approve", entityType: "post", entityId: postId }),
 *   ]);
 *   if (updated.length === 0) throw new NotFoundError("post", postId);
 *   // Accepted residual: a raced 0-row update still commits its audit row
 *   // (no-op audit orphan). The §7 step-4 scoped fetch makes that race
 *   // narrow, and the returning() check above surfaces it loudly.
 *
 * Case B — creates with a DB-generated uuidv7() id: batch statements can't
 * reference sibling results, so create sequentially and audit after; a
 * failed audit then throws (action fails loudly, entity keeps existing —
 * manual-remediation orphan):
 *
 *   const [row] = await db.insert(brands).values({ ...data, orgId: ctx.orgId }).returning();
 *   await recordAuditEvent(ctx, { action: "brand.create", entityType: "brand", entityId: row.id });
 *
 * For high-stakes creates (credit_ledger) that residual is unacceptable —
 * use a single-statement CTE (db.$with insert → audit insert selecting from
 * it); re-verify the API against the installed drizzle in the credits PR
 * (AGENTS.md §3).
 */
export function buildAuditInsert(ctx: AuthCtx, event: OrgAuditEvent) {
  const e = orgAuditEventSchema.parse(event);
  return db.insert(auditLog).values({
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
 * outside a db.batch (Case B above, or better-auth API calls). Throws on
 * invalid input or a failed insert.
 */
export async function recordAuditEvent(
  ctx: AuthCtx,
  event: OrgAuditEvent,
): Promise<void> {
  await buildAuditInsert(ctx, event);
}
