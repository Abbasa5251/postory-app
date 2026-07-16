import * as z from "zod";

/**
 * Auth audit events (ADR-011 "login audit events"). Canonical zod home per
 * AGENTS.md §4 — compose, never redeclare. Org-scoped mutation audit schemas
 * (A5) will live alongside these.
 */
export const authAuditActionSchema = z.enum([
  "auth.sign_in.succeeded",
  "auth.sign_in.failed",
  "auth.sign_up",
  "auth.password_reset.requested",
  "auth.password_reset.completed",
]);

// ip/user-agent are attacker-controlled request data: truncate instead of
// rejecting so an oversized header can never make an audit write fail.
const truncated = (max: number) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .nullish();

// Strict allowlist — the ONLY metadata auth audit events may carry. Unknown
// keys (nested bodies, credentials, tokens) are STRIPPED by z.object's
// default policy rather than hard-rejected: a reject would make the DAL drop
// the entire audit event, and attacker-controlled input must never be able
// to suppress auditing. Either way, nothing outside this allowlist persists.
const authAuditMetadataSchema = z.object({
  // Attempted email from the request body (attacker-controlled) — truncated.
  email: truncated(320),
  // better-auth APIError code, e.g. INVALID_EMAIL_OR_PASSWORD.
  code: truncated(64),
  statusCode: z.number().int().nullish(),
});

export const authAuditEventSchema = z.object({
  action: authAuditActionSchema,
  userId: z.string().nullish(),
  orgId: z.string().nullish(),
  ipAddress: truncated(64),
  userAgent: truncated(512),
  metadata: authAuditMetadataSchema.optional(),
});

export type AuthAuditEvent = z.input<typeof authAuditEventSchema>;

/**
 * Org-scoped mutation audit events (AGENTS.md §6.6) — the input to
 * `recordAuditEvent(ctx, …)`. Deliberately carries NO orgId/actor fields:
 * tenancy and attribution derive exclusively from the AuthCtx inside the
 * DAL, so a caller cannot spoof them even by accident.
 */
export const orgAuditEventSchema = z.object({
  // Dot-namespaced, e.g. 'brand.create', 'post.approve'. Open pattern, not
  // an enum: the action set grows with every feature PR; promote to a
  // central registry at rule-of-two if drift appears.
  action: z
    .string()
    .max(128)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
  ipAddress: truncated(64),
  userAgent: truncated(512),
  // Programmer-authored context (unlike auth metadata above, which is
  // attacker-controlled), so JSON-shape enforcement only. NEVER secrets or
  // payload PII (AGENTS.md §7) — review-enforced.
  metadata: z.record(z.string(), z.json()).optional(),
});

export type OrgAuditEvent = z.input<typeof orgAuditEventSchema>;
