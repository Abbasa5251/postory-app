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
 * Anything that can run an insert — the module `db` or a transaction handle
 * `tx` from `db.transaction()`. Lets `buildAuditInsert` enlist the audit write
 * in the SAME transaction as the mutation it pairs with.
 */
type DbExecutor = Pick<typeof db, "insert">;

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
 * The standard pg driver supports real transactions, so a mutation and its
 * audit run inside one `db.transaction()` — all-or-nothing, and later
 * statements CAN read earlier results (unlike the old neon-http batch). Pass
 * the `tx` handle as the executor so the audit enlists in the same transaction.
 *
 * Case A — entity id known before execution (updates, deletes, state
 * transitions — the common case). A 0-row mutation throws BEFORE the audit
 * write, so the transaction rolls back and leaves no orphan audit row:
 *
 *   return db.transaction(async (tx) => {
 *     const [row] = await tx.update(posts).set(next)
 *       .where(and(orgScope(ctx, posts), eq(posts.id, postId)))
 *       .returning({ id: posts.id });
 *     if (!row) throw new NotFoundError("post", postId);   // rolls back
 *     await buildAuditInsert(ctx, { action: "post.approve", entityType: "post", entityId: postId }, tx);
 *     return row;
 *   });
 *
 * Case B — creates with a DB-generated uuidv7() id whose id the audit needs:
 * insert then audit inside the transaction, reading the returned id:
 *
 *   return db.transaction(async (tx) => {
 *     const [row] = await tx.insert(brands).values({ ...data, orgId: ctx.orgId }).returning();
 *     await buildAuditInsert(ctx, { action: "brand.create", entityType: "brand", entityId: row.id }, tx);
 *     return row;
 *   });
 *
 * For non-transactional call sites (better-auth API calls that already
 * committed), `recordAuditEvent(ctx, event)` runs the audit on the base `db`.
 */
export function buildAuditInsert(
  ctx: AuthCtx,
  event: OrgAuditEvent,
  exec: DbExecutor = db,
) {
  const e = orgAuditEventSchema.parse(event);
  return exec.insert(auditLog).values({
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
 * outside a db.transaction (better-auth API calls that already committed, or a
 * create whose audit doesn't need transactional atomicity). Throws on invalid
 * input or a failed insert.
 */
export async function recordAuditEvent(
  ctx: AuthCtx,
  event: OrgAuditEvent,
): Promise<void> {
  await buildAuditInsert(ctx, event);
}
