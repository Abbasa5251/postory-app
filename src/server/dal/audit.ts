import "server-only";
import { db } from "@/db/db";
import { auditLog } from "@/db/schemas/audit";
import {
  authAuditEventSchema,
  type AuthAuditEvent,
} from "@/lib/validation/audit";

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
