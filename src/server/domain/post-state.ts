import "server-only";
import { ForbiddenError, TransitionError } from "./errors";

export { TransitionError };

/**
 * Post lifecycle state machine (PRD §5, E1) — pure, no I/O, exhaustively
 * unit-tested. The SINGLE source of transition truth (AGENTS.md §4): the DAL
 * (dal/posts.ts) consults `transition()` before every status write and the UI
 * consults `canTransition()` to decide which controls to show — neither
 * encodes the rules itself.
 *
 * DB status strings ≡ machine tokens (no mapping layer, per the posts schema
 * header): POST_STATUSES here MUST stay in lockstep with the posts_status_check
 * CHECK constraint in src/db/schemas/posts.ts.
 *
 * Scope boundaries (E1):
 *   - SCHEDULED/PUBLISHING/PUBLISHED/FAILED are reachable statuses but no
 *     ACTION here produces them — Epic F (schedule) + the Zernio webhook
 *     processor own those edges (§5: PUBLISHING/PUBLISHED/FAILED are set only
 *     by the webhook processor + reconciliation sweep).
 *   - `client_approve`/`client_request_changes` are defined + tested now but are
 *     driven by the client portal (E4); E1 only enters CLIENT_REVIEW.
 */

export const POST_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "CLIENT_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "ARCHIVED",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * The lifecycle actions this machine governs. `submit`/`approve`/
 * `request_changes`/`edit`/`archive` are the E1 internal-stage actions;
 * `client_approve`/`client_request_changes` are the E4 client-stage actions.
 * Scheduling/publishing are NOT actions here (Epic F / the webhook processor).
 */
export type PostAction =
  | "submit"
  | "approve"
  | "request_changes"
  | "edit"
  | "archive"
  | "client_approve"
  | "client_request_changes";

export type TransitionOpts = {
  /** The brand's D2 client-approval toggle — steers the `approve` fork. */
  requiresClientApproval?: boolean;
};

/**
 * Static edges that don't depend on any context. The `approve` fork (its
 * target depends on requiresClientApproval) and `archive` (legal from every
 * live state) are resolved in `resolve()` rather than tabled.
 */
const TABLE: Partial<
  Record<PostStatus, Partial<Record<PostAction, PostStatus>>>
> = {
  DRAFT: { submit: "IN_REVIEW", edit: "DRAFT" },
  // Any content edit after submission/approval reverts to DRAFT (§5).
  IN_REVIEW: { request_changes: "CHANGES_REQUESTED", edit: "DRAFT" },
  CHANGES_REQUESTED: { edit: "DRAFT" },
  CLIENT_REVIEW: {
    client_approve: "APPROVED",
    client_request_changes: "CHANGES_REQUESTED",
    edit: "DRAFT",
  },
  APPROVED: { edit: "DRAFT" },
  // SCHEDULED/PUBLISHING/PUBLISHED/FAILED: no content-edit or review edge
  // here — Epic F unschedules/retries; only `archive` applies (below).
};

/** Resolve the next status, or null if the edge is illegal. Pure. */
function resolve(
  status: PostStatus,
  action: PostAction,
  opts: TransitionOpts,
): PostStatus | null {
  // §5: "Any state → ARCHIVED" (re-archiving an ARCHIVED post is a no-op edge
  // we reject so callers don't write redundant transitions/audit rows).
  if (action === "archive") {
    return status === "ARCHIVED" ? null : "ARCHIVED";
  }
  // The internal-approval fork: only legal from IN_REVIEW; the brand toggle
  // decides whether the client still has to sign off (D2).
  if (action === "approve") {
    if (status !== "IN_REVIEW") return null;
    return opts.requiresClientApproval ? "CLIENT_REVIEW" : "APPROVED";
  }
  return TABLE[status]?.[action] ?? null;
}

/**
 * Apply an action to a status, returning the next status. Throws
 * TransitionError (→ ADR-013 TRANSITION code) when the edge is illegal — the
 * DAL calls this before writing, so an illegal transition never persists.
 */
export function transition(
  status: PostStatus,
  action: PostAction,
  opts: TransitionOpts = {},
): PostStatus {
  const next = resolve(status, action, opts);
  if (next === null) {
    throw new TransitionError(
      `A ${status} post can't be ${action.replace(/_/g, " ")}.`,
    );
  }
  return next;
}

/** Non-throwing predicate for the UI (which controls to show). Pure. */
export function canTransition(
  status: PostStatus,
  action: PostAction,
  opts: TransitionOpts = {},
): boolean {
  return resolve(status, action, opts) !== null;
}

/**
 * The §5 "approving own post" rule: an internal reviewer may not approve a post
 * they authored unless the org has opted in (org_settings.allow_self_approval,
 * default off). ForbiddenError (not TransitionError): the transition itself is
 * legal, the actor is just not allowed to be the one making it. The DAL
 * supplies `isOwnPost` (post.created_by === ctx.memberId) and
 * `allowSelfApproval` (org-settings read); this predicate stays pure.
 */
export function assertCanApprove(input: {
  isOwnPost: boolean;
  allowSelfApproval: boolean;
}): void {
  if (input.isOwnPost && !input.allowSelfApproval) {
    throw new ForbiddenError(
      "You can't approve your own post. Ask another reviewer, or enable self-approval in organization settings.",
    );
  }
}
