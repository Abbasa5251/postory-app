# authz test suite (A8)

The tenant-isolation security boundary (ADR-002) and the §7 role×permission
matrix, in tests. **Release-blocking** (AGENTS.md §11): a failing cross-org or
matrix test blocks deploy, no overrides.

Run alone: `npm run test:authz` · runs in the CI merge gate with the unit suite.

## What lives where

| File | Covers |
|---|---|
| `role-matrix.test.ts` | The coarse role→permission statements. Every cell of the AGENTS.md §7 table asserted against the spec via `roles.<r>.authorize(...)`. |
| `authorize.test.ts` | The §7 coarse gate `authorize(ctx, "resource:action")` (A6): allow → returns void, deny → throws `ForbiddenError`, system ctx → bypass. Representative cells only — role-matrix owns the full truth table. |
| `dal-scoping.test.ts` | Mock-level proof that every exported DAL query renders `org_id = ctx.orgId` (plus brand narrowing, 404-shaped cross-org reads). |
| `permissions.test.ts` | Role set == UI role set; spot-checks (kept from the A5 seed). |
| `assignable-roles.test.ts` | `assertAssignableRole` rejects better-auth's built-in `member` (A4). |

Shared fixtures live in `tests/helpers/` — `ctx.ts` (`memberCtx`/`systemCtx`
factories) and `db-mock.ts` (`makeSelectChain`/`renderedWhere`). Each test file
still declares its own `vi.hoisted` + `vi.mock("@/db/db", …)` (vitest hoists
those per-module); only the chain builder and SQL renderer are shared.

## Adding a DAL method or server action → add matrix cases (AGENTS.md §11)

1. **`role-matrix.test.ts`** — if it introduces a new resource/action, add it to
   `APP_ACTIONS` + the `EXPECTED` table (transcribed from §7, not from
   `permissions.ts`).
2. **`dal-scoping.test.ts`** — add a case proving the new query renders
   `orgScope`, and (for brand-scoped reads) that cross-org/unassigned reads are
   `NotFoundError`, not leaks.

Design intent, not statements: finer domain rules the §7 table names in prose
(approver may not approve their *own* post; creator limited to assigned brands)
are enforced in `src/server/domain/` + the DAL — test them there / in their
feature PR, not as `authorize()` cases.

## Deferred (tracked as `it.todo`, not silently dropped)

- **Live two-org behavioral tests** against a seeded Neon branch — needs test-DB
  infra + GitHub secrets (carry-over, pairs with the Playwright nightly).
  Placeholders in `dal-scoping.test.ts`.
- **Portal-token column** (§7) — `PortalCtx` / `dal/portal.ts` land in Epic E.
  Placeholders in `role-matrix.test.ts`.
