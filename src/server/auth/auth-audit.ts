// NOTE: no `import 'server-only'` — this module is in auth.ts's static import
// graph, which the better-auth CLI loads for schema generation. Pure event
// builders only (no I/O, no db): the DAL writer is reached via dynamic
// import() inside the auth.ts hooks, keeping it out of the CLI's graph.
import { getIP, isAPIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth/types";
import * as z from "zod";
import type { AuthAuditEvent } from "@/lib/validation/audit";

// Structural (not better-auth model types) so the builders stay trivially
// unit-testable; better-auth populates ipAddress/userAgent on the session row
// from the request per `advanced.ipAddress` config.
type SessionForAudit = {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeOrganizationId?: string | null;
};

/** Sign-in success — fired from `databaseHooks.session.create.after`, so it
 * covers every flow that mints a session (email+password, OAuth). */
export function sessionCreatedEvent(session: SessionForAudit): AuthAuditEvent {
  return {
    action: "auth.sign_in.succeeded",
    userId: session.userId,
    orgId: session.activeOrganizationId ?? null,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  };
}

/** Sign-up — fired from `databaseHooks.user.create.after` (email or OAuth). */
export function userCreatedEvent(
  user: { id: string },
  headers: Headers | undefined,
  options: BetterAuthOptions,
): AuthAuditEvent {
  return {
    action: "auth.sign_up",
    userId: user.id,
    ipAddress: headers ? getIP(headers, options) : null,
    userAgent: headers?.get("user-agent") ?? null,
  };
}

const bodyWithEmail = z.object({ email: z.string() });

function extractEmail(body: unknown): string | null {
  const parsed = bodyWithEmail.safeParse(body);
  return parsed.success ? parsed.data.email.toLowerCase() : null;
}

/**
 * Request-pipeline audit mapping for `hooks.after` (ADR-011 login audit).
 * better-auth has no failed-login hook; its dispatcher catches thrown
 * APIErrors, sets `ctx.context.returned` to the error, and still runs
 * `hooks.after` — so failures are observed here by path. Rate-limited
 * requests are rejected before endpoints run and never reach this hook
 * (no audit spam from 429s). Returns null for paths we don't audit.
 */
export function authRequestEvent(input: {
  path: string;
  returned: unknown;
  body: unknown;
  headers: Headers | undefined;
  options: BetterAuthOptions;
}): AuthAuditEvent | null {
  const { path, returned, body, headers, options } = input;
  const failed = isAPIError(returned);
  const base = {
    ipAddress: headers ? getIP(headers, options) : null,
    userAgent: headers?.get("user-agent") ?? null,
  };

  if (path === "/sign-in/email") {
    // Success is audited via session.create.after (also covers OAuth).
    if (!failed) return null;
    const email = extractEmail(body);
    return {
      action: "auth.sign_in.failed",
      ...base,
      metadata: {
        // Attempted email (may not correspond to any user — actorId stays
        // null; attribution happens at query time). Never the password.
        ...(email ? { email } : {}),
        code: returned.body?.code ?? null,
        statusCode: returned.statusCode,
      },
    };
  }

  if (
    (path === "/request-password-reset" || path === "/forget-password") &&
    !failed
  ) {
    // Succeeds even for unknown emails (enumeration protection) — the
    // attempted email is the interesting signal.
    const email = extractEmail(body);
    return {
      action: "auth.password_reset.requested",
      ...base,
      ...(email ? { metadata: { email } } : {}),
    };
  }

  if (path === "/reset-password" && !failed) {
    // Body holds newPassword + token — deliberately NOT recorded.
    return { action: "auth.password_reset.completed", ...base };
  }

  return null;
}
