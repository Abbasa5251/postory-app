# PRD — POSTORY
### AI post generation, approval & scheduling platform for small brand agencies

| | |
|---|---|
| **Status** | v2.1 — decisions locked via founder Q&A; AI layer moved to OpenRouter |
| **Last updated** | 2026-07-15 — A1 done (tooling & CI PR: Vitest, Playwright, Prettier, ESLint boundaries, GitHub Actions); A2 + A3 merged to `master` in PR #2; see Epic A progress log |
| **Supersedes** | PRD v1 (Clerk-based draft) |
| **Builder** | Solo founder, heavy AI-assisted coding |

> **How to use this doc:** checkboxes are the single source of progress truth. Priorities: P0 = launch blocker, P1 = fast follow, P2 = later. §14 lists per-vendor doc sources — re-read them before implementing against any API.

---

## 0. Locked decisions (from founder Q&A, 2026-07-15)

| # | Decision | Consequence |
|---|---|---|
| D1 | **ICP: small agencies (2–10 people, 5–20 clients)** | Studio tier is the anchor plan; fully self-serve onboarding; client-approval workflow is a core differentiator |
| D2 | **Approval: internal + optional per-brand client approval (magic link, no login)** | One toggle per brand; one added state (`CLIENT_REVIEW`); multi-step chains deferred |
| D3 | **Launch platforms: Instagram, Facebook, TikTok, LinkedIn, Threads, YouTube Shorts** | No X at launch → no per-call passthrough costs; video *upload/publishing* is P0 (3 of 6 platforms are video-first) |
| D4 | **AI images at launch; AI video post-launch** | Generation pipeline built model-agnostic; video = new job type later, not a refactor |
| D5 | **Bundled AI credits only (no BYO keys)** | We hold one OpenRouter key; margin on AI; credit ledger is P0 |
| D6 | **No free plan. 14-day trial, no card, capped** | Trial caps: 2 brands, 3 accounts, 150 credits, full features. Expiry → read-only; +7 days → auto-disconnect Zernio accounts |
| D7 | **Full analytics at launch** (dashboards + client-facing reports) | +2–3 weeks scope; reports reuse the client-portal shell from D2 |
| D8 | **Solo founder + AI coding tools** | ~5–6 months to GA; beta ~month 4; low-ops managed services only; §13 AI dev conventions |
| D9 | **Pricing: $59 / $149 / $349** | Thin margins (~35–40%) in early months at Zernio's $6 band, rising to ~75% at scale |
| D10 | **Auth: better-auth (self-hosted) instead of Clerk** | Org/member/invitation tables live in our Postgres; no webhook mirroring; we own auth security |
| D11 | **All AI inference via OpenRouter** (text, images, later video) | One key, one bill, one-string model swaps; dedicated Image API + capability discovery; failed generations unbilled → clean credit refunds (ADR-012) |

### Verified Zernio facts driving this plan
- Pricing is **per connected account, graduated, workspace-wide**: first 2 accounts free (once, for *us* — not per profile/customer), then $6/acct (accounts 3–10), $3 (11–100), $1 (101–2,000), custom past 2,000. Billed by account-days, prorated, end-of-period. No profile limits, all features bundled.
- **One account per platform per profile** (per two independent sources — ⚠ verify with Zernio support, see R1). Two Instagram accounts for one client ⇒ two profiles. Handled by 1:N brand→profile mapping (ADR-009); no cost impact since billing is per account.
- X/Twitter API calls are passed through at cost — irrelevant at launch (no X), budget for it when X ships.
- Webhooks for `post.published` / `post.failed`; analytics, inbox, ads bundled per account.

---

## 1. Product overview

**One-liner:** A team-based SaaS where small brand agencies generate social posts (copy + AI images), route them through internal and client approval, and schedule them to 6 platforms — one workspace per client brand — then prove the results with client-ready analytics.

**Positioning:** Not "cheaper Hootsuite." The pitch is the *closed loop small agencies actually run*: brief → on-brand AI content → internal review → client approves from their phone → auto-publish → monthly client report. Competitors do pieces; we do the loop.

### 1.1 Personas
- **Agency owner** (better-auth `owner`) — billing, seats, brands, everything.
- **Account manager** (`admin` / custom `approver`) — reviews, approves, schedules, owns client relationships.
- **Content creator** (custom `creator`) — drafts, generates, submits; sees only assigned brands.
- **Client stakeholder (external, no account)** — approves posts and views reports via tokenized portal links.

### 1.2 Goals
- Routine post: brief → scheduled in < 5 min.
- Zero posts published without required approvals (internal, and client where enabled).
- Publish reliability ≥ 99.5% (beta), 99.9% (GA).
- Blended gross margin ≥ 55% by month 6 post-GA (rising with Zernio band mix).

### 1.3 Non-goals (v1)
AI video generation (post-launch, D4) · X/Twitter, Pinterest, Bluesky, Reddit, etc. (post-launch platforms) · social listening · paid ads · unified DM inbox · multi-step approval chains · white-label portal domains · native mobile apps · free plan.

---

## 2. Tech stack (verified July 2026 — re-verify at each phase gate)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.x**, App Router, TS strict | Turbopack default; `proxy.ts` (not `middleware.ts`); awaited `params`/`searchParams`; opt-in `"use cache"` — never on tenant data without org-keyed tags |
| React | 19.2 (bundled) | Enable `reactCompiler: true` after perf baseline |
| UI | Tailwind v4 + shadcn/ui + Radix | + **better-auth-ui** (shadcn-compatible auth/org components: `<OrganizationSwitcher/>`, sign-in/up, members & invitations tables) |
| Auth & tenancy | **better-auth + organization plugin** | Self-hosted; org/member/invitation/session tables in our Postgres via its migrations; access-control statements for custom roles; SSO/SAML plugin available later for Enterprise |
| Payments | **Stripe** (direct: Subscriptions, Checkout, Customer Portal, webhooks) | ADR-004 unchanged. better-auth's Stripe plugin NOT used — our credit/overage model needs full control |
| Publishing | **Zernio API** | Profiles/Accounts/Posts/Queue; webhooks; analytics API; OpenAPI + llms.txt available |
| AI — text | LLMs **via OpenRouter** (Vercel AI SDK + OpenRouter provider) | Captions, adaptations, hashtags; brand-voice system prompts; streaming. Model id in `credit_rates` config — swap Claude/GPT/Gemini class models without code change |
| AI — media | **OpenRouter dedicated Image API** (`/api/v1/images`) | Launch models — standard: FLUX.2 (~$0.03/MP), Seedream 4.5 (~$0.04/img); premium: Nano Banana 2 class (~$0.08–0.15). 30+ image models, 8 providers; per-model capabilities (aspect ratios, ref-image limits, pricing) from the discovery endpoint `/api/v1/images/models`. Video models available on OpenRouter for post-launch. Base64 outputs → R2. Model ids + prices in `credit_rates` config table |
| Database | Postgres (Neon) + Drizzle | better-auth tables coexist in same DB → direct FK joins, no sync layer |
| Jobs | **Inngest** (or Trigger.dev — Phase-0 spike) | Generation, publishing, webhook processing, analytics sync, trial lifecycle, retries, per-org concurrency |
| Storage | Cloudflare R2 + CDN | Generated + uploaded media; signed URLs; lifecycle cleanup |
| Cache / RL | Upstash Redis | Rate limits (incl. auth endpoints — ours now), hot config |
| Email | Resend + React Email | Invites, verification, password reset (ours now), approval requests, publish failures, trial nudges, client report links |
| Observability | Sentry + Axiom + Vercel Analytics | Alerts: publish failures, webhook lag, auth anomalies |
| Hosting | Vercel | **Hard rule (D8): nothing self-hosted, nothing that pages a solo founder at 3am** |

---

## 3. Architecture decision records

- [ ] **ADR-001 — Our DB is the source of truth for posts.** Zernio post created only at schedule time; `zernio_post_id` stored; status driven by webhooks + 15-min reconciliation sweep. Zernio isolated behind a `publishing/` module.
- [ ] **ADR-002 (rev) — Tenancy via better-auth organizations.** Org = agency. `organization`, `member`, `invitation`, `session` tables owned by better-auth migrations in our Postgres. Active org read from `session.activeOrganizationId`. **Every domain table carries `org_id` FK → better-auth `organization.id`; every query flows through a data-access layer requiring `orgId`.** No webhook mirroring (Clerk's Epic-A4 deleted). This DAL is now the tenant-isolation *security boundary* — see NFR + authz test suite. *(2026-07-15: better-auth org tables live in Neon; active-org set on sign-in/create/accept verified. DAL itself pending — A5.)*
- [ ] **ADR-003 — All generation & publishing async via Inngest.** Actions enqueue and return job ids; workers do the work; UI polls job status (2s while live). No AI/publish call in a request handler.
- [ ] **ADR-004 — Direct Stripe.** Tier products (monthly + annual) + credit-pack one-off prices + `$9/mo` extra-account subscription item. Entitlements mirrored to `subscriptions` table; hot-path gates read our DB.
- [ ] **ADR-005 — Append-only credit ledger.** Reserve before generation → settle/refund after. Balance = materialized SUM per org.
- [ ] **ADR-006 — Webhook ingestion.** Verify signature → insert `webhook_events` (unique on provider event id) → 200 fast → process via Inngest. Applies to Stripe and Zernio (OpenRouter's Image API is synchronous request/response — no webhook; revisit if async video jobs need one post-launch).
- [ ] **ADR-007 — Media pipeline.** OpenRouter image output (base64) → decode → moderation → R2 (`org/{orgId}/brand/{brandId}/…`) → CDN; public URLs handed to Zernio at publish.
- [ ] **ADR-008 — Client portal is token-based.** Signed, expiring, revocable tokens; scoped to approval sets *or* report views (same shell, two capabilities). All portal actions audited.
- [ ] **ADR-009 (new) — Brand ↔ Zernio profile is 1:N.** Each brand owns a primary profile; connecting a second account of an already-connected platform auto-creates an overflow profile (`profile_no` 2, 3, …). Invisible to users; `social_accounts.zernio_profile_id` records placement. Zero cost impact (billing is per account, profiles unlimited). Remove the auto-overflow codepath if R1 verification shows multiple same-platform accounts per profile are allowed.
- [ ] **ADR-010 (new) — Trial enforcement server-side.** Trial state on the org row (`trial_ends_at`, `trial_state`). Inngest scheduled functions: T-3d nudge email → expiry: flip to `read_only` → +7d: disconnect Zernio accounts (stops account-day billing) + notify. Reactivation on subscribe restores connections list for one-click reconnect.
- [ ] **ADR-012 (new) — All AI inference through OpenRouter (D11).** Text via chat completions (AI SDK OpenRouter provider); images via the dedicated Image API; video post-launch. One `OPENROUTER_API_KEY`. Model ids + prices live in `credit_rates`; per-model capabilities are read from OpenRouter's discovery endpoints, never hardcoded. `src/server/services/openrouter/` is the only module that knows the wire format — preserving a direct-provider escape hatch. Accepted trade-off: one gateway for all AI; mitigated by OpenRouter's multi-provider routing/fallbacks and by not billing failed generations (simplifies credit refunds).
- [ ] **ADR-011 (new) — Auth security is ours now.** better-auth hardening checklist is a P0 deliverable: email verification required, password policy, rate-limited auth endpoints (Upstash), session revocation UI, `secondaryStorage` (Redis) for session lookups, secure cookie config, CSRF posture verified, audit login events. Enterprise SSO/SAML via better-auth SSO plugin (post-launch). *(2026-07-15: verification-required, reset-revokes-sessions, CSRF origin check and revocation UI already in via A2/A3 — see Epic A progress log; rest lands with A4.)*

---

## 4. Tenancy & data model

**Owned by better-auth migrations:** `user`, `session`, `account` (oauth), `verification`, `organization`, `member`, `invitation` (+ optional `team`, `organizationRole` — teams OFF at launch).

**Our domain tables** (all with `id` uuid v7, `org_id` FK, timestamps; indexes on `(org_id, …)`):

| Table | Key columns / purpose |
|---|---|
| `org_settings` | 1:1 with organization: trial_ends_at, trial_state, plan snapshot, defaults |
| `brands` | name, slug, timezone, logo/colors, **voice profile JSONB** (tone, banned words, hashtag sets, sample posts), `requires_client_approval` bool (D2) |
| `zernio_profiles` | `brand_id`, `zernio_profile_id`, `profile_no` (ADR-009) |
| `social_accounts` | `brand_id`, `zernio_profile_id`, platform (enum of 6 at launch), `zernio_account_id`, handle, avatar, status, connected_by |
| `brand_members` | `brand_id`, `member_id` — creator scoping (D1/B5) |
| `posts` | `brand_id`, status (§5), current_version_id, created_by, internal_approved_by, client_decision ref, scheduled_for + tz, `zernio_post_id`, publish_result JSONB, labels |
| `post_versions` | immutable content snapshots per platform (JSONB), media ids, author, version_no |
| `post_platforms` | `post_id`, `social_account_id`, per-platform overrides (first comment, reel/short type), per-platform publish status |
| `media_assets` | `brand_id`, type (image/video/upload), R2 key, dims/duration, source model, generation_job_id, moderation status |
| `generation_jobs` | type (copy/image; video enum reserved), model id, prompt/params, status, credits reserved/settled, provider generation id, error, timings |
| `approvals` | `post_id`, stage (`internal` \| `client`), round, decision, note, decided_by (member id or token id), decided_at |
| `portal_tokens` | hashed token, capability (`approve` \| `report`), scope (post ids / brand+month), expires_at, revoked_at, label |
| `comments` | `post_id`, anchor, body, author (member/token), resolved |
| `credit_ledger` | delta, reason (trial_grant/plan_grant/pack/debit/refund/expiry), ref, expires_at |
| `subscriptions` | Stripe mirror: ids, tier, status, period end, entitlements JSONB |
| `analytics_snapshots` | `post_platform_id`, captured_at, metrics JSONB (reach, likes, comments, shares, clicks, views) — synced from Zernio analytics API |
| `webhook_events` | provider, provider_event_id (unique), payload, processed_at, error |
| `audit_log` | actor (member/token/system), action, entity, diff |

**Roles (better-auth access control statements):** built-in `owner`, `admin`; custom `approver` (post: create/submit/approve/schedule + brand read), `creator` (post: create/submit; scoped by `brand_members`). Clients are never members — tokens only.

---

## 5. Post lifecycle (v2 — adds client review)

```
DRAFT ──submit──▶ IN_REVIEW ──request changes──▶ CHANGES_REQUESTED ──edit──▶ DRAFT
                     │ internal approve
                     ▼
            brand.requires_client_approval?
              no ──▶ APPROVED
              yes ─▶ CLIENT_REVIEW ── client approves ──▶ APPROVED
                        │ client requests changes
                        ▼
                  CHANGES_REQUESTED (with client note)

APPROVED ──schedule──▶ SCHEDULED ──Zernio──▶ PUBLISHING ──▶ PUBLISHED
                           │unschedule                        │
                           ▼                                  ▼
                        APPROVED                       FAILED ──retry──▶ SCHEDULED
Any state ──▶ ARCHIVED
```

Rules (server-enforced, single module, exhaustively unit-tested):
- Approval binds to a `post_version` id; any edit after internal approval reverts to `DRAFT`.
- `CLIENT_REVIEW` entry auto-issues/refreshes a portal token and emails the client contact.
- Approving own post: org setting, default off.
- `PUBLISHING/PUBLISHED/FAILED` set only by Zernio webhook processor + reconciliation sweep.
- Every transition → `audit_log`.

---

## 6. Launch platform matrix (6 platforms — config-driven, verify each against Zernio platform docs at build time)

| Platform | Formats at launch | Notes for validation config |
|---|---|---|
| Instagram | Feed image/carousel, **Reels** | Business/creator accounts only; 4:5 & 1:1 images, 9:16 video; first-comment support |
| Facebook | Page image/video posts | Pages only (no personal profiles — Meta API restriction) |
| TikTok | Video | 9:16; duration + size caps from Zernio TikTok page |
| LinkedIn | Image/video/text, company pages + personal | Professional tone default in AI adaptation |
| Threads | Text/image | 500-char limit; light validation |
| YouTube | **Shorts** | 9:16 ≤ 60s (verify current cap); title required |

Per-platform rules (char limits, media specs, aspect ratios) live in one typed config module consumed by composer validation, preview cards, and pre-publish checks. Adding a platform post-launch = config + preview card + QA, not architecture.

---

## 7. Pricing & packaging (locked D5/D6/D9)

### 7.1 Tiers — no free plan; 14-day no-card trial (caps: 2 brands, 3 accounts, 150 credits, all features)

| | **Starter $59/mo** ($49 annual) | **Studio $149/mo** ($124) — *anchor* | **Agency $349/mo** ($290) | **Enterprise** |
|---|---|---|---|---|
| Brands | 3 | 10 | 30 | Custom |
| Connected accounts | 5 | 12 | 30 | Custom |
| Seats | 3 | 10 | Unlimited | Unlimited |
| AI credits / mo | 500 | 2,000 | 6,000 | Custom |
| AI images | Standard | All models | All models | All |
| AI video (post-launch) | — | Standard | Standard + Premium | All |
| Client approval portal | — | ✓ | ✓ | ✓ |
| Analytics + client reports | Dashboards | Dashboards + reports | Dashboards + reports | ✓ |
| White-label portal (post-launch) | — | — | ✓ | ✓ |
| API access (post-launch) | — | — | ✓ | ✓ |
| SSO (SAML, post-launch) | — | — | Add-on $99/mo | ✓ |

**Add-ons:** extra account $9/mo · extra brand $15/mo (Starter/Studio) · credit packs 1,000/$15 · 5,000/$65 · 20,000/$220 (packs roll 12 months; monthly grants expire at period end).

### 7.2 Credit rates (config table `credit_rates`; retail ≈ $0.015/credit)

| Action | Credits | Approx COGS |
|---|---|---|
| Copy generation (variant batch) | 1 | <$0.01 |
| Image — standard | 3 | ~$0.03–0.04 |
| Image — premium | 12 | ~$0.15 |
| *Reserved:* video std 5s / premium 5s | 30 / 120 | ~$0.30 / ~$1.20 |

### 7.3 Unit economics (corrected — Zernio graduated ladder, workspace-wide)

Our blended Zernio cost per account depends on OUR total connected accounts across all customers:

| Platform stage | Total accounts | Blended $/acct | Starter margin | Studio margin | Agency margin |
|---|---|---|---|---|---|
| Launch | ≤ 10 | ~$6.00 | ~39% | ~40% | ~34% |
| Early growth | ~50 | ~$3.50 | ~58% | ~59% | ~55% |
| ~15 paying customers | ~150 | ~$2.20 | ~68% | ~69% | ~66% |
| Scale | ~1,000 | ~$1.22 | ~77% | ~76% | ~73% |

(Assumes full credit burn at ~50% COGS + $2–5 infra; real burn ~60–70% adds points.) **Takeaway:** thin margins for the first handful of customers are structural and temporary; no action needed beyond the $9 overage floor. Custom Zernio contract only matters past 2,000 accounts.

Trial COGS ceiling ≈ $10/serious evaluator (3 accounts × 14 account-days prorated + ~150 credits). Auto-disconnect at expiry+7d (ADR-010) caps the bleed.

- [ ] Confirm with Zernio support: multiple same-platform accounts per profile? (R1 — affects ADR-009 only)
- [ ] Re-verify OpenRouter model prices at each phase gate (pull from the Image API discovery endpoint, which returns per-endpoint pricing)

---

## 8. Feature breakdown (v2 priorities)

### Epic A — Foundation, auth & tenancy (P0)
- [x] A1. Repo: Next 16 + TS strict + Tailwind 4 + shadcn/ui; ESLint/Prettier; Vitest + Playwright; GitHub Actions CI **(P0)** — *done 2026-07-15, branch `feat/a1-tooling-ci`. Vitest 4 (unit + authz projects, node env, smoke suites incl. role-statement seed of the A8 matrix), Playwright (chromium, prod-build webServer, DB-free smoke spec), Prettier + tailwind plugin (vendored/generated/`*.md` ignored, one-time format), ESLint boundary rules (db→DAL with `auth.ts` exception, lib↛server), GitHub Actions merge gate (typecheck·lint·lint:css·format:check·unit+authz·build, Node 22, dummy env). Deliberate omissions: jsdom/RTL (no component-test suite yet), `@/db/schemas` restriction (A5), nightly e2e workflow (see carry-over)*
- [x] A2. **better-auth core:** email+password + Google OAuth, email verification, password reset (Resend templates), session mgmt **(P0)** — *done 2026-07-15, merged to `master` in PR #2 (`feat/a2-a3-better-auth`). Google OAuth wired but dormant until `GOOGLE_CLIENT_ID/SECRET` land in `.env` (see carry-over)*
- [x] A3. **Organization plugin:** org create on onboarding (org required — no personal mode), invitations, roles (`owner`/`admin` + custom `approver`/`creator` via access-control statements), active-org switching (better-auth-ui components) **(P0)** — *done 2026-07-15, same PR. Verified end-to-end: sign-up → verify → create org → invite `approver` → accept → active-org auto-set; cross-org member-list probe denied (404-shaped)*
- [ ] A4. **Auth hardening checklist (ADR-011):** rate limits, session revocation UI, cookie/CSRF review, login audit events **(P0)** — *head start from A2: email verification required, sessions revoked on password reset, CSRF origin check verified live, session-revocation UI shipped via better-auth-ui `/settings/security`. Remaining: Upstash rate limits on auth endpoints, Redis `secondaryStorage`, password policy, login audit events, cookie review*
- [ ] A5. Drizzle schema + DAL with mandatory org scoping; better-auth tables integrated **(P0)** — *better-auth tables integrated (CLI-generated `src/db/schemas/auth.ts` + migrations, relations merged); `AuthCtx`/`getAuthCtx()` exist in `src/server/auth/context.ts`. Remaining: domain tables + the DAL itself*
- [ ] A6. Env validation (zod), Sentry + Axiom, error conventions **(P0)** — *env validation done (@t3-oss/env-nextjs + zod, split `src/lib/env/{server,client}.ts`); Sentry, Axiom, error conventions pending*
- [ ] A7. App shell: brand sidebar, org switcher, credits meter, trial banner, empty states **(P0)** — *org switcher + user button live in the `(dashboard)` header; rest pending*
- [ ] A8. **Authz test suite:** per-role access matrix tests incl. cross-org isolation (the ADR-002 security boundary) **(P0)** — *manual curl matrix passed on 2026-07-15 (approver `post:approve` ✓ / `brand:create` ✗, cross-org denial); automated suite pending*

#### Epic A progress log & carry-over reminders (added 2026-07-15, A2/A3 PR)

Done in the A2+A3 PR: better-auth **1.7.0-rc.1** instance (`src/server/auth/auth.ts`), role statements (`src/server/auth/permissions.ts` — single source of role truth), `AuthCtx` builder, Resend email service (`src/server/services/email/`), auth schema + migrations applied to Neon (squashed pre-merge into the single `20260715131216_rainy_reaper` — placeholder `tests` table gone), better-auth-ui vendored via shadcn registry, routes `/auth/[path]`, `/onboarding`, gated `/dashboard`, `/settings/[path]`, `/organization/[path]`.

**Merged 2026-07-15 as PR #2** after review. Post-review fixes on the branch: `(dashboard)` layout no longer swallows `ensureSession` failures (real backend errors surface instead of redirecting to sign-in); onboarding org-create wrapped in try/catch/finally (rejected requests set the error state, submit spinner always resets); `SKIP_ENV_VALIDATION` requires the exact value `"1"`; `EMAIL_FROM` promoted from a code constant to an env var (optional in dev with sandbox fallback, production **throws** on the sandbox sender). Also landed: stylelint (Tailwind-v4-aware) + VS Code workspace settings. Vendored better-auth-ui components deliberately kept byte-identical to the upstream registry.

**A1 PR (2026-07-15, `feat/a1-tooling-ci`):** Vitest 4.1.10 (`vitest.config.mts`, `unit` + `authz` projects, node environment, `@` alias + `server-only` stub, `SKIP_ENV_VALIDATION=1`), smoke suites in `tests/unit` (cn) and `tests/authz` (role-statement seed of the A8 matrix), Playwright 1.61 (`tests/e2e/smoke.spec.ts`, chromium, prod-build webServer), Prettier 3.9.5 + tailwindcss plugin (one-time format commit; `.prettierignore` protects vendored auth components, generated schema/migrations, `*.md`), ESLint boundary rules via core `no-restricted-imports` (negative-tested: alias + relative escapes both fire; `auth.ts` allowlisted), `.nvmrc` 22, `.github/workflows/ci.yml` merge gate. CI build proven locally with `.env` absent and dummy env only.

**Carry-over — do later, don't forget:**
- [ ] Bump `better-auth` (+ `auth` CLI dev-dep + `@better-auth/drizzle-adapter`) from **1.7.0-rc.1 → 1.7.0 stable** when released; then **remove `.npmrc` `legacy-peer-deps=true`** (only needed because prerelease versions don't satisfy better-auth-ui's `>=1.6.19` peer ranges) and **remove the `kysely: ^0.28.17` pin** in package.json (kysely-adapter@rc imports root constants that kysely 0.29 moved to `kysely/migration`)
- [ ] Paste `GOOGLE_CLIENT_ID/SECRET` into `.env` (redirect URI `{BETTER_AUTH_URL}/api/auth/callback/google`) — Google button appears automatically, then verify the OAuth flow end-to-end
- [ ] Verify a sending domain in Resend and set the `EMAIL_FROM` env var to a verified-domain sender (it's an env var now, not a code constant; dev falls back to the sandbox `onboarding@resend.dev`, which delivers only to the account owner's address — production refuses to boot on the sandbox fallback)
- [ ] Browser pass of the real email links (verification + password reset) — API flows verified, inbox links not yet clicked
- [x] ESLint guardrails from AGENTS.md §6: `no-restricted-imports` confining `@/db/db` to the DAL (allowlist exception: `src/server/auth/auth.ts`, which the drizzle adapter requires) + lib↛server boundary rules — *done in the A1 PR (also catches relative-path escapes like `../db/db`)*
- [ ] `getAuthCtx()` returns `brandIds: "all"` placeholder — resolve from `brand_members` when B5 lands
- [ ] better-auth's built-in `member` role string is still accepted by the invite **API** (plugin validation); it is never offered in the UI and maps to zero permissions — add an explicit rejection (hook or action-level guard) during A4/A8
- [ ] `auth.ts` and `permissions.ts` intentionally omit `import 'server-only'` (the better-auth CLI rejects it during schema generation) — re-check on CLI upgrades whether the restriction is lifted. Schema regen runs via the existing `npm run auth:schema` script (an earlier note here wrongly claimed the script was dropped; only a duplicate `auth:generate` was)
- [ ] Clean up dev-DB test rows when convenient: users `delivered@resend.dev`, `delivered+approver@resend.dev`, `delivered+outsider@resend.dev`; orgs "Acme Agency", "Rival Agency"
- [ ] Consider DB-level composite uniques on `member(organization_id, user_id)` and `account(provider_id, account_id)` during A5 — better-auth enforces these at the app layer and its CLI owns `src/db/schemas/auth.ts` (hand-edits get clobbered on regen), so this needs either an upstream schema request or a deliberate additive migration outside the generated file
- [ ] Repo uses **npm** (package-lock.json), not pnpm as older notes assumed; `src/db/schemas/` (plural) and split `src/lib/env/{server,client}.ts` are the canonical layouts — AGENTS.md to be reconciled
- [ ] Nightly + pre-release Playwright workflow (AGENTS.md §11): needs a seeded test DB (Neon branch) + GitHub secrets — pair with A8; local `npm run test:e2e` works today against `.env`
- [ ] Vercel deploys currently fail at t3-env validation ("Invalid environment variables") — the Vercel project has no env vars set; its build command is `npm run db:migrate && npm run build`, so it also needs a real `DATABASE_URL` (+ `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, and `EMAIL_FROM` for production). Part of the Phase-0 "deploy on merge" exit criterion
- [ ] Optional: bump `@types/node` `^20` → `^22` to match `.nvmrc` (Node 22 in CI)

### Epic B — Brands & social accounts (P0)
- [ ] B1. Brand CRUD → creates primary Zernio profile (ADR-009) **(P0)**
- [ ] B2. Brand voice profile (feeds all AI) + client contact email (for approval/report links) **(P0)**
- [ ] B3. Connect accounts via Zernio OAuth (6 launch platforms); overflow-profile auto-create on same-platform duplicates; connection health + reconnect prompts **(P0)**
- [ ] B4. Entitlement enforcement (brands/accounts/seats/credits) + trial caps + upgrade CTAs **(P0)**
- [ ] B5. Per-brand member access (`brand_members`) — creators see assigned brands only **(P0 — raised from P1: core to agency ICP)**

### Epic C — Composer & AI copy (P0)
- [ ] C1. Multi-platform composer: per-platform tabs, char counters, validation from §6 config **(P0)**
- [ ] C2. AI copy: brief → variants (streaming), brand voice applied, hashtags + first comment, refine loop **(P0)**
- [ ] C3. Write-once → per-platform adaptation **(P0)**
- [ ] C4. Media: upload (image + **video** — TikTok/Shorts/Reels are P0) with per-platform spec validation; asset library picker **(P0)**
- [ ] C5. Feed-accurate preview cards for all 6 platforms **(P0 — raised: 3 video platforms make previews essential for approvals)**
- [ ] C6. Emoji/UTM/mentions helpers **(P2)**

### Epic D — AI image generation (P0)
- [ ] D1. Prompt builder seeded from caption + brand style; standard/premium model tiers; aspect presets (1:1, 4:5, 9:16, 16:9) **(P0)**
- [ ] D2. Inngest pipeline: reserve credits → OpenRouter Image API call → decode base64 result → moderation → R2 → attach; settle/refund (failed generations are unbilled by OpenRouter → always refund reserved credits) **(P0)**
- [ ] D3. Generation UI: progress states, 2–4 variant grid, regenerate with edited prompt **(P0)**
- [ ] D4. Asset library per brand: search/filter, usage count, delete + orphan cleanup **(P0)**
- [ ] D5. Moderation (prompt + output) with block + log **(P0)**
- [ ] D6. Image editing: platform crop, text overlay, logo stamp **(P1)**
- [ ] D7. *Post-launch:* AI video generation (std/premium tiers, duration presets, plan-gated) — pipeline hooks already present **(P1 post-launch)**
- [ ] D8. Per-org spend guardrails (premium caps) **(P1)**

### Epic E — Approvals & client portal (P0)
- [ ] E1. State machine §5 + role gates + audit **(P0)**
- [ ] E2. Review queue ("needs my approval") with filters **(P0)**
- [ ] E3. Comments + @mentions + resolve; email notifications on submit/approve/changes **(P0)**
- [ ] E4. **Client portal (capability: approve):** magic link, mobile-first, approve / request changes with note, per-brand toggle, token expiry/revoke, agency logo header **(P0 — per D2)**
- [ ] E5. Version history + diff + restore **(P1)**
- [ ] E6. White-label portal (custom slug/branding removal) **(P1 post-launch, Agency tier)**
- [ ] E7. Multi-step chains **(P2)**

### Epic F — Scheduling & publishing (P0)
- [ ] F1. Schedule → Zernio post create (accounts array, `scheduledFor`, tz); store id **(P0)**
- [ ] F2. Calendar: month/week, per-brand + cross-brand, drag-reschedule (PATCH Zernio), status colors, filters **(P0)**
- [ ] F3. Zernio webhooks (`post.published`/`post.failed`): verify → ingest → process → notify **(P0)**
- [ ] F4. Reconciliation sweep (15 min) + drift alerts **(P0)**
- [ ] F5. Failure UX: per-platform partial failures, retry, expired-token → reconnect **(P0)**
- [ ] F6. Best-time suggestions / Zernio Queue slots **(P1)**
- [ ] F7–F8. Bulk CSV; evergreen recycling **(P2)**

### Epic G — Analytics & client reports (P0 — per D7)
- [ ] G1. Analytics sync: Inngest scheduled pulls from Zernio analytics API for published posts (24h/72h/7d/30d snapshots → `analytics_snapshots`) **(P0)**
- [ ] G2. Post-level metrics on post detail + calendar hover **(P0)**
- [ ] G3. Brand dashboard: totals + trends per platform, top posts, cadence (recharts) **(P0)**
- [ ] G4. **Client-facing monthly report:** portal token (capability: report) — branded web view per brand+month: highlights, top posts, per-platform table; “Send to client” email; print-friendly (PDF export P1) **(P0)**
- [ ] G5. AI usage analytics for owners (credits by brand/member/model) **(P1)**

### Epic H — Billing, trial & plans (P0)
- [ ] H1. Trial lifecycle (ADR-010): signup grant (150 credits, caps), nudge, read-only, auto-disconnect, reactivation **(P0)**
- [ ] H2. Stripe: tier products (mo/annual), Checkout upgrade from trial, Customer Portal **(P0)**
- [ ] H3. Stripe webhooks → `subscriptions` mirror; dunning; downgrade = read-only excess (never delete) **(P0)**
- [ ] H4. Credit system: grants on `invoice.paid`, ledger ops, meter UI, 80%/100% alerts **(P0)**
- [ ] H5. Credit packs + auto-top-up **(P1)**
- [ ] H6. $9 extra-account overage item **(P1)**
- [ ] H7. Pricing page + in-app gating + proration flows **(P0)**

### Epic I — Robustness (P0, continuous)
- [ ] I1. Rate limiting (mutations, generation concurrency, **auth endpoints**) **(P0)**
- [ ] I2. Idempotency keys for Zernio/Stripe/OpenRouter-creating actions **(P0)**
- [ ] I3. Zod on every action input + webhook payload **(P0)**
- [ ] I4. Feature flags (DB-backed) **(P1)**
- [ ] I5. k6 load test: publish + generation paths **(P0 pre-GA)**
- [ ] I6. Neon PITR + R2 versioning + restore runbook **(P0)**
- [ ] I7. Security pass: authz suite green, SSRF-safe media fetch, secrets rotation, dep audit in CI **(P0)**
- [ ] I8. GDPR export/delete (incl. Zernio teardown, R2 purge) **(P1)**

---

## 9. UX principles
Unchanged from v1 (calm, composer-as-hero, honest async, status-always-visible, WCAG 2.1 AA) plus:
- **Client portal is the agency's stage:** agency logo, zero learning curve, approve-from-phone < 30s, report readable by a non-marketer.
- Trial UX sells: day-1 checklist (create brand → connect account → generate → schedule), trial banner with countdown + single upgrade CTA.

---

## 10. Non-functional requirements
As v1 (perf, reliability, scale, cost-control targets) with revisions:
- **Tenant isolation is self-enforced** (no vendor boundary): DAL + authz test suite are release-blocking; cross-org access test failures block deploy.
- **Auth availability = app availability:** better-auth session lookups backed by Redis `secondaryStorage`; auth error monitoring in Sentry.
- Golden-path E2E (must stay green): signup→verify→org→brand→connect · draft→AI copy→AI image→submit · internal approve→client portal approve→schedule→publish-webhook→PUBLISHED · analytics snapshot→client report link · trial expiry→read-only→subscribe→reactivate.

---

## 11. Risks & open questions (v2)

| # | Risk / question | Mitigation / owner |
|---|---|---|
| R1 | **One-account-per-platform-per-profile is from third-party sources** | Ask Zernio support before Phase 1 ends; ADR-009 absorbs either answer |
| R2 | Early-stage margins ~35–40% while in Zernio $6 band | Structural + temporary (§7.3); $9 overage floor; no action |
| R3 | Solo-founder bus factor & burnout | Managed services only; scope discipline (this doc); beta gate before GA |
| R4 | Self-hosted auth security | ADR-011 checklist is P0; better-auth is well-audited OSS but config is ours |
| R5 | Trial abuse (no card) | Caps + disposable-email blocklist + per-IP signup limits; add card-gate if abused |
| R6 | Zernio outage = missed publishes | Sweep + alerts; `publishing/` abstraction keeps exit option |
| R7 | AI model churn / gateway dependency | OpenRouter makes model swaps one-string config changes; the `openrouter` service module keeps a direct-provider fallback possible; OpenRouter itself routes across providers with fallbacks |
| R8 | Full analytics at launch stretches solo timeline | G-epic scoped to Zernio-API-only data (no direct platform APIs); report = web view first, PDF later |
| Q1 | Inngest vs Trigger.dev | Phase-0 spike |
| Q2 | Client report cadence/content per platform | Design with 2–3 design-partner agencies during beta |

---

## 12. Phase plan (solo + AI-assisted; calendar weeks, expect ±20%)

### Phase 0 — Foundations (wk 1–2)
- [ ] Epic A complete (incl. auth hardening A4 + authz suite A8) · job-runner spike decided · design tokens · staging/prod + CI/CD + Sentry
- **Exit:** deploy on merge; sign up, verify, create org, invite member, switch org — all real. *(2026-07-15: the auth half of the exit criterion works locally — A1/A2/A3 done incl. CI merge gate; A4–A8 and deploys pending.)*

### Phase 1 — Brands, accounts, composer (wk 3–6)
- [ ] Epic B (B1–B5) · Epic C (C1–C5, incl. video upload)
- **Exit:** connect real accounts on all 6 platforms; hand-write a multi-platform draft with image + video media and accurate previews.

### Phase 2 — AI generation + credits core (wk 7–10)
- [ ] Epic D (D1–D5) · ledger mechanics (H4 core, hardcoded trial grant)
- **Exit:** brief → copy variants → image variants attached; credits reserve/settle/refund proven incl. failure paths.

### Phase 3 — Approvals + client portal (wk 11–13)
- [ ] Epic E (E1–E4)
- **Exit:** full loop: submit → internal approve → client approves from a phone via magic link; audit complete.

### Phase 4 — Scheduling & publishing (wk 14–17)
- [ ] Epic F (F1–F5) · I1–I3 hardening on publish path
- **Exit:** posts publish to all 6 platforms; failure/retry/reconnect proven; calendar drag-reschedule works. **→ Start design-partner beta (3–5 agencies, manual/free billing).**

### Phase 5 — Analytics & reports (wk 18–20, beta running)
- [ ] Epic G (G1–G4)
- **Exit:** dashboards live on real beta data; first client report links sent by beta agencies.

### Phase 6 — Billing & trial (wk 21–22)
- [ ] Epic H (H1–H4, H7)
- **Exit:** self-serve trial → subscribe → entitlements → monthly credit cycle; beta agencies converted to real plans.

### Phase 7 — Hardening & GA (wk 23–26)
- [ ] I5–I7 · E5 · G5 · polish from beta feedback · publish reliability ≥ 99.5% over 2 weeks · GA go/no-go
- **Post-GA queue:** AI video (D7), white-label (E6), credit packs/overages (H5/H6), PDF reports, X/Pinterest/Bluesky, SSO, inbox, bulk CSV.

---

## 13. AI-assisted development conventions (D8)

Since one founder + coding agents build this, the repo carries the guardrails:

- [ ] **`CLAUDE.md` / agent rules file** at repo root covering: stack versions + Next 16 conventions (`proxy.ts`, awaited params, `"use cache"` policy), DAL-only DB access, "every domain query takes `orgId`", state-machine/ledger changes require tests-first, zod at every boundary, no new deps without note in PR description, file/module layout map.
- [ ] **Vendor context for agents:** pin links in the rules file — Next.js `/docs/llms.txt`, Zernio `docs.zernio.com` (llms.txt + OpenAPI), better-auth docs, Stripe docs, OpenRouter docs (`openrouter.ai/docs`; image model catalog via `/api/v1/images/models`). Optionally wire Zernio's MCP server + Next.js DevTools MCP into the coding environment.
- [ ] **Work-order discipline:** implement from this PRD's checkboxes; one checkbox ≈ one PR-sized task with acceptance criteria; agents never combine schema migrations with business-logic changes in one task.
- [ ] **Test gates the agent must satisfy:** state machine, entitlements, credit ledger, authz matrix — unit tests exist before implementation changes merge; golden-path E2E runs in CI nightly.
- [ ] **Human-review hotspots** (never auto-merge): auth config, DAL, webhook verification, Stripe amounts, anything touching `credit_ledger`.

---

## 14. Success metrics (90 days post-GA)

| Metric | Target |
|---|---|
| Trial → activation (brand + account + 1 scheduled post in 7 days) | ≥ 45% |
| Trial → paid conversion | ≥ 10% (no-card trials; watch closely) |
| Time-to-first-scheduled-post | median < 20 min |
| Publish success | ≥ 99.5% |
| Client-portal approval median turnaround | < 24h |
| % posts using AI media | ≥ 50% |
| % paying orgs sending ≥1 client report/mo | ≥ 40% |
| Logo churn | < 4%/mo |
| Blended gross margin | ≥ 55% by month 6 |

---
