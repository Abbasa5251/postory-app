import "server-only";

/**
 * The result envelope every server action returns (ADR-013). Expected failures
 * — validation, domain errors, forbidden/unauthorized — come back as `ok:false`
 * so forms and clients branch on `code` and render field errors, rather than
 * being thrown. Only genuinely unexpected errors escape as throws (dev) or the
 * generic INTERNAL envelope (prod).
 */
export type ActionError = {
  /**
   * Machine-readable code. Wrapper-produced: `VALIDATION`, `UNAUTHORIZED`,
   * `INTERNAL`. Domain-produced: the thrown `DomainError.code` (`NOT_FOUND`,
   * `FORBIDDEN`, and future `ENTITLEMENT`/`TRANSITION`/`INSUFFICIENT_CREDITS`).
   */
  code: string;
  /** User-safe message. Never leaks internals or other-tenant existence (§7). */
  message: string;
  /** Per-field zod errors, present only for `VALIDATION` (feeds form UIs). */
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionError };
