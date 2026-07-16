import "server-only";

/**
 * Typed domain errors (AGENTS.md §9) — thrown from src/server/domain/ and
 * the DAL; server actions map them to user-safe messages. This file is the
 * canonical home: EntitlementError, TransitionError and
 * InsufficientCreditsError extend DomainError here when their feature PRs
 * land (B4, E1, D2) — extend, never fork.
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
