---
status: accepted
---

# ADR-013 — Server-action error contract: hand-rolled `withAction` + typed result envelope

## Context

AGENTS.md §7 prescribes a fixed, ordered server-action pipeline (validate → authenticate →
authorize → scoped fetch → domain rules → persist + audit → UI → return minimal data), and §9
requires actions to "map domain errors to user-safe messages" without leaking internals or
other-tenant existence. Epic A6 establishes this convention *before* any server action exists
(`src/server/actions/` is empty today) so that Epic B's first real actions — and every action
after — adopt one consistent shape rather than each inventing its own.

## Decision

Every mutation is authored through a **hand-rolled `withAction(schema, permission, handler)`**
wrapper that returns an RPC-style action `(input: unknown) => Promise<ActionResult<T>>`, matching
the §7 template signature. The wrapper owns the standardized prefix of the pipeline: zod-parse the
`unknown` input → build `AuthCtx` via `getAuthCtx()` → call a new thin `authorize(ctx, permission)`
(the coarse static permission gate; contextual/entity-level checks stay downstream in the DAL and
domain layer). The handler receives `(data, ctx)` and owns the scoped fetch, domain rules, persist,
audit, and revalidation.

Actions return a discriminated result envelope, never ad-hoc shapes:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };
```

Error handling is by class:

- **`ZodError`** → returned as `{ code: 'VALIDATION', fieldErrors }` (so `useActionState` forms can
  render per-field messages) — returned, not thrown.
- **`DomainError`** subclasses (`NotFoundError`, `ForbiddenError`, and future
  `EntitlementError`/`TransitionError`/`InsufficientCreditsError`) → returned as
  `{ code: err.code, message: err.message }` — the user-safe message.
- **`UnauthorizedError`** (thrown by `getAuthCtx()` when there is no session /
  active org — it deliberately is *not* a `DomainError`) → returned as
  `{ code: 'UNAUTHORIZED', message }`, and **not** reported: an unauthenticated
  caller is expected traffic, not a Sentry-worthy event.
- **Unexpected** errors → `captureError(err, { ctx })` (Sentry, tagged org/member/role) +
  structured `log.error`, then **swallow-and-report**: in production return
  `{ code: 'INTERNAL', message: <generic> }` (never the raw error); in development **re-throw** so
  the stack surfaces in the Next overlay. Because unexpected errors are swallowed rather than
  re-thrown in production, there is no double-capture with Sentry's `onRequestError`, which remains
  registered to catch errors thrown *outside* actions (RSC render, route handlers).

## Considered options

- **`next-safe-action` / `zsa`.** Mature, typed, with zod binding and auth middleware. Rejected:
  §7's pipeline is opinionated and specific (our `getAuthCtx()`, our `permissions.ts`, our DAL
  scoping, our `audit_log`), so a library's middleware would mostly wrap our own helpers anyway,
  while adding a dependency whose API and upgrade cadence we'd have to track (§9). The wrapper's
  real surface is ~40 lines we fully control.
- **Throw-based, no envelope.** Actions throw; `error.tsx`/`global-error.tsx` boundaries render and
  Sentry's `onRequestError` captures. Rejected: it discards typed field/domain errors that forms
  need and error-boundaries the whole route on any expected failure — worse UX for forms, which are
  imminent in Epics B/C.

## Consequences

- The `withAction` wrapper and `authorize()` helper are load-bearing: changing the contract later
  means touching every action. This is why it is fixed now, while the cost is ~zero actions.
- `authorize()` lives in `src/server/auth/` — a §13 human-review hotspot — and every new DAL
  method/action must add cases to `tests/authz` (per `tests/authz/README.md`).
- Forms consume `ActionResult` via a `toFormAction` adapter (a documented one-liner for now; built
  for real when the first `useActionState` form lands in Epic B/C).
- Route handlers and webhook handlers are **not** covered by this contract; they follow their own
  verify-and-return conventions in their epics.
