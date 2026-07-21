import "server-only";

/**
 * Typed domain errors (AGENTS.md §9) — thrown from src/server/domain/ and
 * the DAL; server actions map them to user-safe messages. This file is the
 * canonical home: EntitlementError and TransitionError extend DomainError
 * here when their feature PRs land (B4, E1) — extend, never fork.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}

/**
 * 404-shaped (AGENTS.md §7): "doesn't exist" and "exists in another org /
 * outside your brand access" are deliberately indistinguishable, so the
 * message never reveals other-tenant existence.
 */
export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";

  constructor(entityType: string, id?: string) {
    super(id ? `${entityType} not found: ${id}` : `${entityType} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * 403-shaped — reserved for "entity IS visible to the caller, but the action
 * is denied for their role" (safe to reveal). Cross-org/unassigned access is
 * NotFoundError, never this.
 */
export class ForbiddenError extends DomainError {
  readonly code = "FORBIDDEN";

  constructor(message = "You are not allowed to do this") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * The org's credit balance can't cover a generation (C2/D2, ADR-005). Safe to
 * reveal — it's the caller's OWN balance, not cross-tenant existence — so it
 * carries the shortfall for a helpful UI message. `withAction` maps the
 * INSUFFICIENT_CREDITS code without reporting it to Sentry (an expected
 * failure, not a bug). Thrown BEFORE the OpenRouter call so nothing is spent.
 */
export class InsufficientCreditsError extends DomainError {
  readonly code = "INSUFFICIENT_CREDITS";

  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Insufficient credits: need ${required}, have ${available}.`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * An uploaded object failed the server-authoritative media gate (C4, D-C4-3):
 * the actual (HEAD-read) MIME type or size is unsupported, or the object is
 * missing (the client never completed the PUT). Safe to reveal — it's the
 * caller's own file — so it carries a helpful message. `withAction` maps the
 * MEDIA_REJECTED code without reporting to Sentry (an expected failure).
 */
export class MediaRejectedError extends DomainError {
  readonly code = "MEDIA_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "MediaRejectedError";
  }
}
