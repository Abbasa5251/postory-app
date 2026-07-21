/**
 * Infrastructure error for the object-storage service (NOT a DomainError —
 * like ZernioError / OpenRouterError). Signals a config or upstream (R2 /
 * MinIO) failure; the caller maps it to a user-safe action error.
 *
 * No `import "server-only"` needed on this leaf, but the barrel (index.ts) is
 * server-only so the service can never reach a client bundle.
 */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}
