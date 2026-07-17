import "server-only";
import * as z from "zod";
import { authorize } from "@/server/auth/authorize";
import { getAuthCtx, UnauthorizedError } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";
import type { MemberCtx } from "@/server/dal/types";
import { DomainError } from "@/server/domain/errors";
import { captureError, log } from "@/server/services/observability";
import type { ActionResult } from "./types";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * The canonical server-action wrapper (ADR-013 / AGENTS.md §7). Every mutation
 * is authored through it, so the standardized front of the pipeline —
 * validate → authenticate → authorize — happens once, consistently, and every
 * failure maps to the typed `ActionResult` envelope.
 *
 *   export const createBrand = withAction(createBrandSchema, "brand:create",
 *     async (data, ctx) => { ...scoped fetch, domain rules, persist + audit... });
 *
 * The handler receives validated `data` and the member `ctx`, and owns the rest
 * of §7 (scoped fetch, domain rules, persist + `audit_log`, `revalidatePath`) —
 * the wrapper deliberately does NOT own audit or revalidation.
 *
 * Error handling by class:
 *   - ZodError        → { code: "VALIDATION", fieldErrors } (returned)
 *   - DomainError     → { code: err.code, message } (returned; incl. Forbidden)
 *   - UnauthorizedError → { code: "UNAUTHORIZED" } (returned)
 *   - anything else   → reported via captureError + log.error, then INTERNAL in
 *                       production / re-thrown in development so the stack
 *                       surfaces in the overlay. Swallowing (not re-throwing) in
 *                       prod is why there is no double-capture with Sentry's
 *                       onRequestError, which covers throws outside actions.
 */
export function withAction<TSchema extends z.ZodType, TData>(
  schema: TSchema,
  permission: Permission,
  handler: (data: z.infer<TSchema>, ctx: MemberCtx) => Promise<TData>,
): (input: unknown) => Promise<ActionResult<TData>> {
  return async (input: unknown): Promise<ActionResult<TData>> => {
    // 1. VALIDATE — expected failure, returned (not thrown) so forms can render
    //    per-field messages while staying interactive.
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      // flattenError's fieldErrors is `Record<string, string[] | undefined>`;
      // at runtime every present key holds an array — narrow for the envelope.
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<
        string,
        string[]
      >;
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "The submitted data is invalid.",
          fieldErrors,
        },
      };
    }

    // Declared outside the try so the catch can tag captureError/log with the
    // ctx when it's already resolved (it may still be undefined if getAuthCtx
    // itself threw).
    let ctx: MemberCtx | undefined;
    try {
      // 2. AUTHENTICATE — orgId derives from the session only (§6.3); a
      //    client-supplied orgId is never accepted.
      ctx = await getAuthCtx();
      // 3. AUTHORIZE — coarse static gate (§7); contextual checks stay in the
      //    handler's DAL/domain calls.
      authorize(ctx, permission);
      // 4-7. Handler owns scoped fetch, domain rules, persist + audit, revalidate.
      const data = await handler(parsed.data, ctx);
      return { ok: true, data };
    } catch (error) {
      // Expected + user-safe: mapped to the envelope, never reported.
      if (error instanceof DomainError) {
        return {
          ok: false,
          error: { code: error.code, message: error.message },
        };
      }
      if (error instanceof UnauthorizedError) {
        return {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "You must be signed in to do this.",
          },
        };
      }
      // Unexpected: report with tenant context, then swallow to INTERNAL in
      // production; re-throw in development so the full stack hits the overlay.
      captureError(error, { ctx });
      log.error("unhandled action error", {
        permission,
        org: ctx?.orgId,
        member: ctx?.memberId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (process.env.NODE_ENV !== "production") throw error;
      return {
        ok: false,
        error: { code: "INTERNAL", message: GENERIC_MESSAGE },
      };
    }
  };
}
