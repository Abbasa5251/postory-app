import "server-only";

/**
 * Observability service (A6): Sentry error capture + structured logging.
 * Sentry runtime init lives where Next.js mandates (src/sentry.*.config.ts,
 * src/instrumentation*.ts); these are the helpers app code calls.
 */
export { captureError } from "./capture";
export { log } from "./log";
