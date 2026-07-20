/**
 * Infrastructure error for the OpenRouter service (NOT a DomainError — like
 * ZernioError). Signals a config or upstream failure; the Inngest job maps it
 * to a job failure + credit refund (OpenRouter doesn't bill failed
 * generations, ADR-012).
 *
 * No `import "server-only"` needed on this leaf, but the barrel (index.ts) is
 * server-only so the service can never reach a client bundle.
 */
export class OpenRouterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenRouterError";
  }
}
