<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# POSTORY

> **POSTORY** is a production SaaS for small brand agencies (2–10 people, 5–20 clients): AI post generation (copy + images — ALL AI inference via OpenRouter), internal + client approval workflow, scheduling/publishing to 6 social platforms via Zernio, analytics with client-facing reports, Stripe billing with an AI-credit system.
>
> This file is the contract for every AI coding agent and human working in this repo. If an instruction here conflicts with your instinct or memory, **this file wins**. If reality (docs, code) conflicts with this file, flag it in your PR notes — do not silently work around it.
>
> Source of work orders: `docs/PRD.md` (PRD v2). One checkbox in the PRD ≈ one PR-sized task.

---

## 0. Prime directives (non-negotiable, in priority order)

1. **RESEARCH DOCS BEFORE CODE.** Before writing or modifying any code that touches a library or external API, verify the installed version and consult that version's current documentation. Never code against a remembered API surface. (§3)
2. **SEARCH BEFORE YOU WRITE.** Before implementing any function, component, schema, or query, search the codebase for an existing implementation to reuse or extend. Duplication is a bug. (§4)
3. **ALL DATA GOES THROUGH THE DAL.** No database access outside `src/server/dal/`. Every DAL call is org-scoped and role-aware. There are zero exceptions, including "quick" scripts, webhooks, and jobs. (§6)
4. **SECURITY LIVES ON THE BACKEND.** Every authentication, authorization, tenancy, entitlement, and validation check is enforced server-side. Client-side checks exist only to improve UX and are assumed hostile/absent. (§7)
5. **SMALL, TESTED, REVIEWABLE CHANGES.** One task = one concern = one PR. Schema migrations never ship in the same task as business-logic changes. Critical modules (§11) get tests before implementation.

---

## 1. What POSTORY is (context for every task)

- **Tenancy:** organization (= agency, owned by better-auth) → brands (= client workspaces, ours) → Zernio profiles (1:N per brand, ADR-009) → social accounts.
- **Core loop:** brief → AI copy + AI images (both via OpenRouter) → internal approval → optional client approval via tokenized magic link → schedule → Zernio publishes → webhook confirms → analytics synced → monthly client report.
- **Launch platforms (6):** Instagram, Facebook, TikTok, LinkedIn, Threads, YouTube Shorts. No X at launch.
- **Money:** Stripe subscriptions ($59/$149/$349 + annual) + AI credit ledger (append-only, reserve → settle/refund). 14-day no-card trial with caps; no free plan.
- **Non-negotiable product invariants:** no post is ever published without required approvals; no scheduled post is ever silently dropped; one org can never see another org's data.

---

## 2. Tech stack (canonical versions live in `package.json`, not here)

| Layer | Library | Docs entry point |
|---|---|---|
| Framework | Next.js 16.x (App Router, Turbopack) | `https://nextjs.org/docs` — index at `/docs/llms.txt`; pages available as `.md` |
| Language | TypeScript (strict) | — |
| UI | Tailwind CSS v4, shadcn/ui, Radix, better-auth-ui | `tailwindcss.com/docs`, `ui.shadcn.com`, `better-auth-ui.com/docs` |
| Auth & orgs | better-auth + organization plugin | `better-auth.com/docs` (organization plugin page is required reading for any auth task) |
| ORM / DB | Drizzle ORM + Neon Postgres | `orm.drizzle.team/docs`, `neon.com/docs` |
| Jobs | Inngest | `inngest.com/docs` |
| Publishing | Zernio API | `docs.zernio.com` — ships llms.txt + OpenAPI spec; per-platform pages under `/platforms` |
| AI — ALL inference | **OpenRouter** — text via chat completions (Vercel AI SDK + OpenRouter provider); images via the dedicated Image API; video post-launch | `openrouter.ai/docs`; image model catalog + per-endpoint capabilities at `/api/v1/images/models` (and `/{id}/endpoints`); `ai-sdk.dev/docs` for the SDK layer |
| Billing | Stripe | `docs.stripe.com` (check `/llms.txt`) |
| Storage | Cloudflare R2 (S3 API) | `developers.cloudflare.com/r2` |
| Cache/RL | Upstash Redis + `@upstash/ratelimit` | `upstash.com/docs` |
| Email | Resend + React Email | `resend.com/docs`, `react.email/docs` |
| Validation | Zod | `zod.dev` |
| Testing | Vitest, Playwright, k6 | respective docs |
| Observability | Sentry, Axiom | respective docs |

---

## 3. Documentation research protocol (MANDATORY — prime directive #1)

Your training data is stale for every library above. Assume it. The procedure for **any** task touching a library or external API:

1. **Check the installed version first:** read `package.json` (and lockfile if ambiguous). The version installed is the version you code against.
2. **Fetch the docs for that version** from the entry points in §2. Prefer llms.txt / `.md` doc endpoints when available (Next.js, Zernio, and others expose them). For Zernio, the OpenAPI spec is the ground truth for request/response shapes.
3. **Verify the exact API surface** you're about to use: function signatures, option names, return shapes, error types. Do not guess parameter names.
4. **If docs contradict existing code in the repo,** the docs for our installed version win — but flag the discrepancy in your PR notes instead of silently refactoring unrelated code.
5. **If docs contradict this file,** stop and flag it. Do not improvise.

### Known version-specific gotchas (verified for our stack — re-verify on upgrades)

- **Next.js 16:** `middleware.ts` is now `proxy.ts`. `params` and `searchParams` in pages/layouts are **Promises — always `await` them**. Caching is opt-in via `"use cache"`; **never** apply `"use cache"` to tenant-scoped data without org-keyed `cacheTag`s (default: don't cache tenant data at all). Turbopack is the default bundler. Server Components by default; add `"use client"` only at interactive leaves.
- **better-auth:** organization/member/invitation/session tables are generated by better-auth migrations and live in OUR Postgres — never hand-edit their columns; extend via the plugin's `additionalFields` if needed. Active org comes from `session.activeOrganizationId`. Custom roles (`approver`, `creator`) are defined via access-control statements in `src/server/auth/permissions.ts` — that file is the single source of role truth.
- **Zernio:** one account per platform per profile (pending R1 verification — see ADR-009). Post creation returns a `zernio_post_id` we must persist. Webhooks must be signature-verified. Billing is per connected account (account-days) — disconnecting accounts stops the meter, which the trial-expiry job relies on.
- **Stripe:** we use Subscriptions + Checkout + Customer Portal + webhooks directly (NOT better-auth's Stripe plugin, NOT Clerk Billing patterns from old tutorials). Amounts are integers in the smallest currency unit. Webhook handlers must verify signatures with the raw request body.
- **OpenRouter (ADR-012 — every AI call goes through it):** text = OpenAI-compatible chat completions via the AI SDK OpenRouter provider. Images = the **dedicated Image API** (`POST /api/v1/images`), NOT LLM-image chat models. Per-model capabilities (aspect ratios, reference-image limits, max outputs, pricing) differ — read them from `/api/v1/images/models/{id}/endpoints` instead of hardcoding or guessing. Images return **base64** — decode and store in R2; never assume URLs. Failed/cancelled generations are NOT billed by OpenRouter — always refund reserved credits on error. Model ids and prices come from the `credit_rates` config table, never hardcoded. All generation runs inside Inngest jobs, never request handlers.

---

## 4. Reuse-before-write protocol (DRY — prime directive #2)

Before writing ANY new function, component, hook, schema, query, or constant:

1. **Search the codebase** for existing implementations. Minimum search pass:
   - `src/server/dal/` — does a DAL method already fetch/mutate this?
   - `src/server/actions/` — does a server action already do this mutation?
   - `src/lib/` — shared utilities, formatters, platform config, constants
   - `src/lib/validation/` — zod schemas (NEVER redefine a schema that exists)
   - `src/components/` — UI primitives and feature components
   - `src/server/services/` — integration clients (zernio, openrouter, stripe, storage, email)
   - Search by concept, not just name: grep for the table name, the route, the Zernio endpoint, the zod schema fields.
2. **Extend, don't fork.** If something close exists, extend it (add a parameter, generalize the type) rather than copying it. If extension would break existing callers, discuss in PR notes.
3. **Rule of two:** the moment logic appears in a second place, extract it to the appropriate shared module. Never let it reach a third.
4. **Single sources of truth** (never duplicate these anywhere — import them):

| Concern | Canonical module |
|---|---|
| Platform rules (char limits, media specs, aspect ratios) | `src/lib/platforms/config.ts` |
| Post state machine + transitions | `src/server/domain/post-state.ts` |
| Role/permission statements | `src/server/auth/permissions.ts` |
| Entitlement checks (plan caps) | `src/server/domain/entitlements.ts` |
| Credit rates & model catalog | `credit_rates` table via `src/server/dal/credits.ts` |
| Zod schemas | `src/lib/validation/` (one schema per concept, composed — never inlined copies) |
| Env access | `src/lib/env.ts` (zod-validated; never `process.env` elsewhere) |
| Zernio/OpenRouter/Stripe/R2/Resend clients | `src/server/services/{zernio,openrouter,stripe,storage,email}/` |

5. **Forbidden duplication smells:** a second `formatDate`, a second Instagram char limit constant, a copy-pasted auth check, an inline `db.select` (that one's also a §6 violation), a re-declared zod object for a shape that exists.

---

## 5. Project structure (where code lives — do not invent new top-level homes)

```
src/
  app/                     # Next.js App Router. Route files stay THIN:
    (auth)/                #   compose DAL reads + render. No business logic,
    (dashboard)/           #   no db, no fetch to third parties.
    (portal)/              # client portal (token-based, no session)
    api/
      webhooks/            # stripe/, zernio/ — verify → persist → 200 → enqueue
      inngest/             # Inngest serve endpoint
  components/              # ui/ (shadcn primitives), features/<domain>/
  lib/                     # Isomorphic-safe: env.ts, utils, platforms/, validation/
  server/                  # SERVER-ONLY. Every file imports 'server-only'.
    auth/                  # better-auth instance, permissions.ts, session helpers
    dal/                   # THE ONLY PLACE THAT TOUCHES THE DB (§6)
    domain/                # pure business logic: post-state, entitlements, credits math
    actions/               # server actions: validate → authorize → domain → dal → audit
    services/              # third-party clients: zernio/, openrouter/, stripe/, storage/, email/
    jobs/                  # Inngest functions (generation, publishing, analytics, trial)
  db/
    schema/                # Drizzle schema (one file per domain area)
    migrations/            # generated SQL — reviewed, never hand-edited after merge
tests/
  unit/                    # domain, dal helpers, validation
  authz/                   # the cross-org / role matrix suite (§11 — release-blocking)
  e2e/                     # Playwright golden paths
docs/
  PRD.md                   # work orders (checkboxes)
  adr/                     # one file per ADR
CLAUDE.md                  # this file
```

Placement rules:
- Route handlers and pages are orchestration only. If a `page.tsx` or route handler exceeds ~50 lines of logic, you've put logic in the wrong layer.
- `src/server/domain/` is pure (no I/O, no db) — this is what gets exhaustively unit-tested.
- Nothing in `src/lib/` may import from `src/server/` (enforced by ESLint boundaries).

---

## 6. Data access layer — tenancy & role-scoped data (prime directive #3)

**The DAL is the security boundary of this product.** We self-host auth; there is no vendor wall between tenants. A missed `org_id` filter = agency A reads agency B's client data = company-ending bug.

### Hard rules

1. **The Drizzle `db` client is imported ONLY inside `src/server/dal/`.** An ESLint `no-restricted-imports` rule enforces this. If you need data anywhere else, you add or use a DAL method.
2. **Every DAL function takes an `AuthCtx` as its first argument** and applies org scoping itself — callers cannot forget it because it isn't optional:

```ts
// src/server/dal/types.ts
export type AuthCtx = {
  orgId: string;            // from session.activeOrganizationId — NEVER from client input
  memberId: string;
  role: Role;               // 'owner' | 'admin' | 'approver' | 'creator'
  brandIds: string[] | 'all'; // resolved brand access (creators: from brand_members)
};
```

```ts
// CORRECT — src/server/dal/posts.ts
export async function listPostsForBrand(ctx: AuthCtx, brandId: string, filter: PostFilter) {
  assertBrandAccess(ctx, brandId);                      // role/brand scoping (throws)
  return db.select().from(posts).where(and(
    eq(posts.orgId, ctx.orgId),                         // tenancy — ALWAYS, even with FK joins
    eq(posts.brandId, brandId),
    ...buildFilter(filter),
  ));
}
```

```ts
// FORBIDDEN — anywhere outside the DAL
import { db } from '@/db/client';           // ❌ ESLint blocks this import
const rows = await db.select().from(posts)  // ❌ no ctx, no org filter
  .where(eq(posts.brandId, brandId));       // ❌ brandId trusted from client
```

3. **`ctx` is constructed in exactly one place** — `src/server/auth/context.ts` (`getAuthCtx()`): reads the better-auth session, resolves `activeOrganizationId`, role, and `brand_members` rows. Server actions and route handlers call it; nothing else builds an `AuthCtx` by hand. Client-supplied `orgId` is NEVER accepted — deriving org from anything but the session is a security bug.
4. **Every domain table has `org_id`** (FK → better-auth `organization.id`) and every query filters on it — including tables reachable through a brand FK. Belt AND suspenders: the wristband check is cheap; a wrong join is not.
5. **Role-scoped visibility inside the org** is also the DAL's job:
   - `owner` / `admin` / `approver`: all brands in the org.
   - `creator`: only brands in `brand_members` (resolved into `ctx.brandIds`).
   - Client portal tokens never produce an `AuthCtx` — they use the separate, narrower `PortalCtx` (token id, capability, scoped post/brand ids) with dedicated DAL methods in `src/server/dal/portal.ts` that can only read what the token scopes.
6. **Writes audit themselves:** every mutating DAL method (or the action wrapping it) writes `audit_log`. If you add a mutation without an audit entry, the PR is incomplete.
7. **Background jobs get a system context** via `getSystemCtx(orgId)` — explicit org, `role: 'system'`, full brand access, audited as `actor: system`. Jobs still go through the DAL.

### Better-auth-owned tables
`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` are managed by better-auth. Access them via better-auth APIs or read-only DAL helpers in `src/server/dal/org.ts`. Never write to them directly with Drizzle.

---

## 7. Security model — backend only (prime directive #4)

Client-side gating (hiding buttons, disabling forms, route guards in `proxy.ts`) is **UX sugar**. Every one of these is re-enforced on the server, because the client is assumed to be a hostile script with a stolen session cookie's worth of access.

### The server action template (every mutation follows it, in this order)

```ts
'use server';
export async function approvePost(input: unknown) {
  const data = approvePostSchema.parse(input);        // 1. VALIDATE (zod, on `unknown`)
  const ctx = await getAuthCtx();                     // 2. AUTHENTICATE (throws if no session/org)
  authorize(ctx, 'post:approve');                     // 3. AUTHORIZE (role permission — throws)
  const post = await dal.posts.getById(ctx, data.postId); // 4. SCOPED FETCH (tenancy + brand access)
  const next = transition(post, 'approve', ctx);      // 5. DOMAIN RULES (state machine — throws)
  await dal.posts.saveTransition(ctx, next);          // 6. PERSIST + AUDIT
  revalidatePath(...);                                // 7. UI
  return result;                                      // 8. Return minimal data, never raw rows with other-tenant refs
}
```

Steps 1–6 are mandatory and ordered. A mutation missing any of them does not merge.

### Authorization matrix (single source: `src/server/auth/permissions.ts`)

| Permission | owner | admin | approver | creator | portal token |
|---|---|---|---|---|---|
| org: billing, members, settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| brand: create/edit/delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| account: connect/disconnect | ✅ | ✅ | ✅ | ❌ | ❌ |
| post: create/edit/submit | ✅ | ✅ | ✅ | ✅ (assigned brands) | ❌ |
| post: approve/request-changes (internal) | ✅ | ✅ | ✅ (not own post, per org setting) | ❌ | ❌ |
| post: approve/request-changes (client stage) | ❌ | ❌ | ❌ | ❌ | ✅ (`approve` capability, scoped posts) |
| post: schedule/unschedule/retry | ✅ | ✅ | ✅ | ❌ | ❌ |
| AI: generate (spends credits) | ✅ | ✅ | ✅ | ✅ (assigned brands) | ❌ |
| analytics: view | ✅ | ✅ | ✅ | ✅ (assigned brands) | ✅ (`report` capability, scoped brand+month) |

### Additional hard security rules

- **Webhooks (Stripe, Zernio):** verify signature against the **raw body** → insert into `webhook_events` (unique on provider event id — replay-safe) → return 200 fast → process via Inngest. Business logic in a webhook route handler is a rejected PR.
- **Portal tokens:** generated with `crypto` randomness, **stored hashed**, carry capability + scope + expiry, revocable, single-brand. Portal routes never touch session auth; portal DAL methods cannot read outside token scope. Every portal action → `audit_log`.
- **Idempotency:** any action creating external objects (Zernio posts, Stripe sessions, OpenRouter generations) sends an idempotency key derived from our entity id, and is safe to retry.
- **Rate limiting (Upstash):** auth endpoints (login, signup, reset, portal token attempts), mutation actions per user, generation concurrency per org. New externally-reachable endpoints must state their rate-limit decision in the PR.
- **Media handling is SSRF-safe:** OpenRouter images arrive as base64 (no server-side fetch needed). Any server-side fetch of remote media is restricted to an explicit host allowlist; never fetch arbitrary user-supplied URLs server-side.
- **Secrets:** only via `src/lib/env.ts`. Never log them, never send to the client, never commit. `NEXT_PUBLIC_` prefix = public by definition — nothing sensitive.
- **Auth hardening (ADR-011)** is a maintained checklist: email verification required, rate-limited auth routes, session revocation UI, Redis `secondaryStorage`, secure cookies, login audit events. Changes to better-auth config require human review (§13).
- **Errors:** never leak internals or other-tenant existence. Not-found and forbidden-in-another-org both return the same 404-shaped error.

---

## 8. Domain invariants (memorize before touching related code)

### Post state machine (`src/server/domain/post-state.ts` — pure, exhaustively tested)
```
DRAFT → IN_REVIEW → (CHANGES_REQUESTED → DRAFT) | approved-internal
approved-internal → APPROVED                     (brand.requires_client_approval = false)
approved-internal → CLIENT_REVIEW → APPROVED | CHANGES_REQUESTED   (= true)
APPROVED → SCHEDULED ⇄ (unschedule) ; SCHEDULED → PUBLISHING → PUBLISHED | FAILED → retry → SCHEDULED
any → ARCHIVED
```
- Approval binds to a `post_version` id; **any content edit after internal approval reverts to DRAFT.**
- `PUBLISHING/PUBLISHED/FAILED` are set ONLY by the Zernio webhook processor + reconciliation sweep. Never by user actions, never manually.
- Entering `CLIENT_REVIEW` issues/refreshes a portal token and emails the brand's client contact.

### Credit ledger (`credit_ledger` — append-only)
- Never UPDATE or DELETE ledger rows. Corrections are compensating entries.
- Generation flow: **reserve (debit) → run → settle (adjust) or refund (credit)**. Reserve happens BEFORE the OpenRouter call — this ordering prevents race-condition overspend and is not negotiable.
- Balance = SUM over ledger per org (materialized, invalidated on write). Monthly plan grants expire at period end; purchased packs expire at 12 months (`expires_at`).

### Entitlements (`src/server/domain/entitlements.ts`)
- Pure functions over `subscriptions.entitlements` + current counts (brands, accounts, seats, credits) + trial caps. UI and server both import from here; the server check is the real one.
- Downgrade/trial-expiry NEVER deletes data — excess goes read-only. Trial expiry +7 days → Inngest job disconnects Zernio accounts (stops account-day billing) and records it for one-click reconnect.

### Zernio mapping (ADR-001/-009)
- Our DB is the source of truth; Zernio post created only at schedule time; persist `zernio_post_id`.
- Brand → zernio_profiles is 1:N: connecting a second account of an already-present platform on a brand auto-creates the next `profile_no`. Users never see profiles.
- A 15-minute reconciliation sweep compares `SCHEDULED/PUBLISHING` posts against Zernio and alerts on drift. Do not "fix" statuses in ad-hoc code — fix the sweep or processor.

---

## 9. Coding conventions

- **TypeScript strict; `any` is banned in domain/DAL/actions** (`unknown` + zod parse at boundaries). `as` casts need a comment justifying them.
- **Validate at every trust boundary:** server action inputs, route handler bodies, webhook payloads, Inngest event data, external API responses (Zernio/OpenRouter responses get parsed with zod schemas in `src/server/services/*/schemas.ts`).
- **RSC by default.** `"use client"` only for interactivity (composer, calendar drag, generation progress). Data flows down from server components via DAL reads; client components receive plain serializable props.
- **No `fetch` to third parties outside `src/server/services/`.** Each service module owns its client, error mapping, retries, and zod response schemas.
- **Errors:** typed domain errors (`ForbiddenError`, `EntitlementError`, `TransitionError`, `InsufficientCreditsError`) thrown from domain/DAL; actions map them to user-safe messages; Sentry captures with org/member tags (never payload PII).
- **Naming:** DB `snake_case`, TS `camelCase` (Drizzle mappings), components `PascalCase`, files `kebab-case.ts`. Booleans read as predicates (`requiresClientApproval`).
- **Dates:** store UTC `timestamptz`; schedule with the brand's IANA timezone; format only at the UI edge.
- **Money:** integer cents. Credits: integers.
- **Imports:** absolute `@/` paths; ESLint boundary rules (app → server/actions+dal-reads; lib imports nothing from server; db client only in dal).
- **New dependencies require justification in the PR description** (what, why, alternatives considered, weekly downloads/maintenance sanity check). Prefer stdlib/existing deps.
- **Comments** explain *why*, not *what*. Every non-obvious business rule cites its PRD section or ADR (e.g. `// ADR-005: reserve before run`).

---

## 10. Background jobs (Inngest) conventions

- One function per file in `src/server/jobs/`, named `domain/event.action` (e.g. `generation/image.requested`).
- Steps are idempotent and use `step.run` boundaries so retries never double-charge credits or double-create Zernio posts (pair with idempotency keys, §7).
- Jobs use `getSystemCtx(orgId)` and the DAL — never raw db.
- Every job declares: retry policy, concurrency key (usually `orgId`), and failure behavior (what the user sees). Generation failures must refund reserved credits in a `step.run` that executes even after prior step failures.
- Scheduled jobs registry (do not duplicate schedules): reconciliation sweep (15 min), analytics sync (daily + 24h/72h/7d/30d post snapshots), trial lifecycle (nudge/expire/disconnect), credit grants on `invoice.paid`, orphaned-media cleanup (weekly).

---

## 11. Testing gates (what must be green to merge)

| Suite | Scope | Rule |
|---|---|---|
| `tests/unit/domain` | post-state, entitlements, credit math | **Tests FIRST** for any change here; exhaustive transition coverage (~90% branch) |
| `tests/authz` | cross-org isolation + full role×permission matrix incl. portal tokens | **Release-blocking.** Any new DAL method or action adds matrix cases. A failing cross-org test blocks deploy, no overrides |
| `tests/unit` (dal helpers, validation) | scoping helpers, zod schemas | On change |
| `tests/e2e` (Playwright) | golden paths: signup→org→brand→connect · draft→AI copy→image→submit · internal→client-portal approve→schedule→publish-webhook→PUBLISHED · analytics→client report · trial expiry→read-only→subscribe | Nightly in CI + before release |
| k6 | publish + generation paths | Pre-GA and before scaling changes |

Webhook processors are tested with recorded fixture payloads (valid, invalid-signature, replayed, out-of-order).

---

## 12. Task & git discipline

- **One PRD checkbox ≈ one PR.** State the checkbox id (e.g. `E4`) in the PR title. Small enough to review in 15 minutes.
- **Migrations ship alone.** Schema change PR (schema + generated SQL + backfill note) merges and deploys before the logic PR that uses it. An agent must never combine them.
- **Never hand-edit** a merged migration; create a new one.
- **PR description template:** what & why (PRD/ADR ref) · docs consulted (with versions — §3 receipt) · reuse check performed (what you searched, what you extended — §4 receipt) · security notes (new endpoints? rate limit? authz cases added?) · test evidence.
- Conventional commits (`feat:`, `fix:`, `chore:`, `db:`). Feature branches off `main`; preview deploy per PR; `main` is always deployable.
- Leave the campsite cleaner, but **no drive-by refactors** in a task PR — file a note instead.

## 13. Human-review hotspots (an agent NEVER merges these unattended)

1. Anything in `src/server/auth/` (better-auth config, permissions, context construction)
2. Anything in `src/server/dal/` that changes scoping/`AuthCtx` handling
3. Webhook signature verification code
4. Stripe: amounts, products/prices, subscription lifecycle handlers
5. `credit_ledger` writes or credit math
6. Post state machine transitions
7. Portal token generation/validation
8. DB migrations
9. `src/lib/env.ts` / CI / deploy configuration
10. This file

## 14. Commands

```bash
pnpm dev                 # next dev (Turbopack)
pnpm build && pnpm start
pnpm typecheck           # tsc --noEmit
pnpm lint                # ESLint (includes boundary + no-restricted-imports rules)
pnpm test                # vitest unit + authz
pnpm test:authz          # the tenancy/role matrix suite alone
pnpm test:e2e            # playwright
pnpm db:generate         # drizzle-kit generate (schema → SQL)
pnpm db:migrate          # apply migrations
pnpm db:studio
pnpm inngest:dev         # local Inngest dev server
```
CI gate = typecheck + lint + unit + authz + build. E2E nightly + pre-release.

## 15. Environment variables (all consumed ONLY via `src/lib/env.ts`)

`DATABASE_URL` · `BETTER_AUTH_SECRET` · `BETTER_AUTH_URL` · `GOOGLE_CLIENT_ID/SECRET` · `ZERNIO_API_KEY` · `ZERNIO_WEBHOOK_SECRET` · `OPENROUTER_API_KEY` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET` · `UPSTASH_REDIS_REST_URL/TOKEN` · `RESEND_API_KEY` · `SENTRY_DSN` · `INNGEST_EVENT_KEY/SIGNING_KEY` · `APP_URL`

Adding a variable = update `env.ts` schema + `.env.example` + deployment docs in the same PR.

## 16. Anti-patterns — instant PR rejection

- ❌ `db` imported outside `src/server/dal/`
- ❌ Any query missing `org_id` scoping, or trusting client-supplied `orgId`/`brandId`/role
- ❌ Security/permission/entitlement check that exists only on the client
- ❌ Coding a library API from memory without a §3 docs check (receipt required in PR)
- ❌ Writing a function/schema/constant that already exists (no §4 search receipt)
- ❌ Business logic in `page.tsx`, route handlers, or webhook handlers
- ❌ AI/publish/network call inside a request handler instead of an Inngest job
- ❌ UPDATE/DELETE on `credit_ledger`; charging credits after (not before) generation
- ❌ Setting `PUBLISHING/PUBLISHED/FAILED` outside the webhook processor/sweep
- ❌ `"use cache"` on tenant-scoped data without org-keyed tags
- ❌ Hand-editing better-auth tables or merged migrations
- ❌ Schema migration + business logic in one PR
- ❌ `any` in domain/DAL/actions; unvalidated `unknown` crossing a boundary
- ❌ Secrets in code, logs, client bundles, or `NEXT_PUBLIC_*`
- ❌ Skipping the audit log on a mutation
- ❌ New dependency with no justification

---