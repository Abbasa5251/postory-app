import "server-only";

/**
 * Infrastructure error for the Zernio integration — NOT a DomainError (those
 * are for business rules, §9). A ZernioError thrown inside a `withAction`
 * handler surfaces as INTERNAL (Zernio being down is a genuine server-side
 * failure, reported via Sentry); the interactive connect/callback route
 * handlers catch it explicitly and redirect with an error flag (ADR-014).
 */
export class ZernioError extends Error {
  readonly code: string;
  /** HTTP status from Zernio, when the failure was an API response. */
  readonly status?: number;

  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "ZernioError";
    this.code = opts.code ?? "ZERNIO_ERROR";
    this.status = opts.status;
  }
}
