import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { AuthCtx } from "@/server/dal/types";

/**
 * A6 — report an unexpected error to Sentry, tagged with the tenant context so
 * failures are diagnosable per org/member without digging. Its intended caller
 * is the action wrapper's unexpected-error path (`withAction`, lands in A6·3),
 * plus any other server surface catching a genuinely unexpected throw.
 *
 * PII posture (§7/§9): only `org`/`member`/`role` tags are attached — never the
 * request payload or user PII (`sendDefaultPii` is off in the Sentry config).
 * No-ops silently when Sentry has no DSN, so local dev and CI are unaffected.
 */
export function captureError(error: unknown, opts?: { ctx?: AuthCtx }): void {
  Sentry.captureException(error, (scope) => {
    const ctx = opts?.ctx;
    if (ctx) {
      scope.setTags({
        org: ctx.orgId,
        role: ctx.role,
        // MemberCtx carries memberId; SystemCtx (jobs) carries jobName — either
        // way this identifies the actor without any PII.
        member: "memberId" in ctx ? ctx.memberId : ctx.jobName,
      });
    }
    return scope;
  });
}
