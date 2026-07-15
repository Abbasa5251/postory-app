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

export const authAuditEventSchema = z.object({
  action: authAuditActionSchema,
  userId: z.string().nullish(),
  orgId: z.string().nullish(),
  ipAddress: truncated(64),
  userAgent: truncated(512),
  // Failure reason, attempted email — NEVER credentials or tokens.
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuthAuditEvent = z.input<typeof authAuditEventSchema>;
