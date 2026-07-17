# PRD — POSTORY
### AI post generation, approval & scheduling platform for small brand agencies

| | |
|---|---|
| **Status** | v2.1 — decisions locked via founder Q&A; AI layer moved to OpenRouter |
| **Last updated** | 2026-07-17 — **Epic B underway: B1 (Brand CRUD) and B2 (voice profile + client contact) both merged to master.** B1 via PR #20 (create, #18) + PR #21 (edit, #19); B2 via PR #24 (#22/#23). First Epic B work: feature server actions, `withAction` forms, shared `useActionForm` + `BrandTimezoneField` + the `applyBrandUpdate` DAL helper; **ADR-009 amended to lazy Zernio-profile provisioning**; `CONTEXT.md` glossary (Brand / Voice Profile / Brand Hashtags / Client / …). Each shipped via /grill → /to-spec → /to-tickets → /implement with two-axis (Standards + Spec) review. Next up: B3 (Zernio account connection) / B5 (per-brand member access). See Epic B progress log. Earlier same day: A6 (error conventions + Sentry + Axiom) implemented in PR #16 (`feature/a6-observability-error-conventions`), pending review (§13.1 `authorize()` gate + §13.9 Sentry config): `authorize()` coarse permission gate + typed `Permission`, errors-only Sentry across server/edge/client (+ `onRequestError` + branded `global-error`), `captureError`/`log` observability service (Axiom via Vercel Log Drain), `withAction` + `ActionResult` envelope (ADR-013); built + reviewed as three tickets #13/#14/#15 on one branch. A8 merged as PR #9 (`test/a8-authz-suite`): exhaustive §7 role×permission matrix + mock-level DAL tenancy proof on shared fixtures + convention doc; live two-org DB tests and portal-token column deferred as tracked `it.todo`; A5 merged (PR #6); A4 done (PR #4); A1 merged (PR #3); A2 + A3 merged in PR #2; §13 conventions marked done (AGENTS.md); see Epic A progress log |
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
- [ ] **ADR-009 (new; amended 2026-07-17, B1 grill) — Brand ↔ Zernio profile is 1:N, profile provisioned lazily.** A brand owns a *primary* profile (`profile_no` 1), but the `zernio_profiles` row and the Zernio `POST /api/v1/profiles` call are created **on first account placement (B3), not at brand creation (B1)** — a brand with zero connected accounts has no Zernio profile at all. This keeps brand creation a pure local mutation with no external dependency (Zernio being slow/down can't fail or slow a brand create). Connecting a second account of an already-connected platform auto-creates an overflow profile (`profile_no` 2, 3, …). Invisible to users; `social_accounts.zernio_profile_id` records placement. Zero cost impact (billing is per account, profiles unlimited). Remove the auto-overflow codepath if R1 verification shows multiple same-platform accounts per profile are allowed.
- [ ] **ADR-010 (new) — Trial enforcement server-side.** Trial state on the org row (`trial_ends_at`, `trial_state`). Inngest scheduled functions: T-3d nudge email → expiry: flip to `read_only` → +7d: disconnect Zernio accounts (stops account-day billing) + notify. Reactivation on subscribe restores connections list for one-click reconnect.
- [ ] **ADR-012 (new) — All AI inference through OpenRouter (D11).** Text via chat completions (AI SDK OpenRouter provider); images via the dedicated Image API; video post-launch. One `OPENROUTER_API_KEY`. Model ids + prices live in `credit_rates`; per-model capabilities are read from OpenRouter's discovery endpoints, never hardcoded. `src/server/services/openrouter/` is the only module that knows the wire format — preserving a direct-provider escape hatch. Accepted trade-off: one gateway for all AI; mitigated by OpenRouter's multi-provider routing/fallbacks and by not billing failed generations (simplifies credit refunds).
- [x] **ADR-011 (new) — Auth security is ours now.** better-auth hardening checklist is a P0 deliverable: email verification required, password policy, rate-limited auth endpoints (Upstash), session revocation UI, `secondaryStorage` (Redis) for session lookups, secure cookie config, CSRF posture verified, audit login events. Enterprise SSO/SAML via better-auth SSO plugin (post-launch). *(2026-07-15: complete — verification-required, reset-revokes-sessions, CSRF origin check, revocation UI via A2/A3; rate limits, Redis secondaryStorage, HIBP password check, login audit, cookie review via A4. Checklist stays maintained: new auth surface re-opens it.)*
- [x] **ADR-013 (new) — Server-action error contract.** Every mutation is authored through a hand-rolled `withAction(schema, permission, handler)` wrapper (not `next-safe-action`/`zsa` — §7's pipeline is specific to our helpers) returning a typed `ActionResult` envelope. Expected failures — `VALIDATION` (zod fieldErrors), any `DomainError` by `code`, `UNAUTHORIZED` — are **returned**, not thrown, so forms get structured errors; only genuinely unexpected errors escape (reported via Sentry `captureError` + `log`, then swallowed to `INTERNAL` in prod / re-thrown in dev). Full record in `docs/adr/ADR-013-server-action-error-contract.md`; usage in `src/server/actions/README.md`. *(2026-07-17, A6 / PR #16.)*

---

## 4. Tenancy & data model

**Owned by better-auth migrations:** `user`, `session`, `account` (oauth), `verification`, `organization`, `member`, `invitation` (+ optional `team`, `organizationRole` — teams OFF at launch).

**Our domain tables** (all with `id` uuid v7, `org_id` FK, timestamps; indexes on `(org_id, …)`). Denormalized ownership columns (`org_id`, `brand_id`, `post_id`) are DB-enforced via composite FKs against `(…, id)` unique keys on the parent — a child row can never claim another tenant's brand/post/account (2026-07-16 A5 review hardening; nullable `SET NULL` attribution refs excluded — full skip list in the Epic A progress log):

| Table | Key columns / purpose |
|---|---|
| `org_settings` | 1:1 with organization: trial_ends_at, trial_state, plan snapshot, defaults |
| `brands` | name, slug, timezone, logo/colors, **voice profile JSONB** (tone, banned words, hashtag sets, sample posts), `requires_client_approval` bool (D2) |
| `zernio_profiles` | `brand_id`, `zernio_profile_id`, `profile_no` (ADR-009) |
| `social_accounts` | `brand_id`, `zernio_profile_id`, platform (enum of 6 at launch), `zernio_account_id`, handle, avatar, status, connected_by |
| `brand_members` | `brand_id`, `member_id` — creator scoping (D1/B5) |
| `posts` | `brand_id`, status (§5), current_version_id, created_by, internal_approved_by, client_decision ref, scheduled_for + tz, `zernio_post_id`, publish_result JSONB, labels |
| `post_versions` | immutable content snapshots per platform (JSONB), media ids, author, version_no |
| `post_platforms` | `brand_id` (denormalized so composite FKs prove post + account share one brand), `post_id`, `social_account_id`, per-platform overrides (first comment, reel/short type), per-platform publish status |
| `media_assets` | `brand_id`, kind (image/video), source (upload/generated), R2 key, dims/duration, source model, generation_job_id, moderation status |
| `generation_jobs` | type (copy/image; video enum reserved), model id, prompt/params, status, credits reserved/settled, provider generation id, error, timings |
| `approvals` | `post_id`, stage (`internal` \| `client`), round, decision, note, decided_by (member id or token id — stage-bound by CHECK: member ↔ internal, token ↔ client), decided_at |
| `portal_tokens` | hashed token, capability (`approve` \| `report`), scope (post ids / brand+month), expires_at, revoked_at, label |
| `comments` | `post_id`, anchor, body, author (member/token), resolved |
| `credit_ledger` | delta, reason (trial_grant/plan_grant/pack/debit/refund/expiry), ref, expires_at — append-only enforced by PG triggers rejecting UPDATE/DELETE (org-cascade teardown exempt) |
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
- [x] A1. Repo: Next 16 + TS strict + Tailwind 4 + shadcn/ui; ESLint/Prettier; Vitest + Playwright; GitHub Actions CI **(P0)** — *done 2026-07-15, merged to `master` in PR #3 (`feat/a1-tooling-ci`). Vitest 4 (unit + authz projects, node env, smoke suites incl. role-statement seed of the A8 matrix), Playwright (chromium, prod-build webServer, DB-free smoke spec), Prettier + tailwind plugin (vendored/generated/`*.md` ignored, one-time format), ESLint boundary rules (db→DAL with `auth.ts` exception, lib↛server), GitHub Actions merge gate (typecheck·lint·lint:css·format:check·unit+authz·build, Node 22, dummy env). Deliberate omissions: jsdom/RTL (no component-test suite yet), `@/db/schemas` restriction (A5), nightly e2e workflow (see carry-over)*
- [x] A2. **better-auth core:** email+password + Google OAuth, email verification, password reset (Resend templates), session mgmt **(P0)** — *done 2026-07-15, merged to `master` in PR #2 (`feat/a2-a3-better-auth`). Google OAuth wired but dormant until `GOOGLE_CLIENT_ID/SECRET` land in `.env` (see carry-over)*
- [x] A3. **Organization plugin:** org create on onboarding (org required — no personal mode), invitations, roles (`owner`/`admin` + custom `approver`/`creator` via access-control statements), active-org switching (better-auth-ui components) **(P0)** — *done 2026-07-15, same PR. Verified end-to-end: sign-up → verify → create org → invite `approver` → accept → active-org auto-set; cross-org member-list probe denied (404-shaped)*
- [x] A4. **Auth hardening checklist (ADR-011):** rate limits, session revocation UI, cookie/CSRF review, login audit events **(P0)** — *done 2026-07-15, shipped as PR #4 (founder folded the stacked hardening PR #5 into it pre-merge; migration + logic reviewed together as one unit). Migration half (`db/a4-audit-log`): audit_log table, uuid v7 via Neon PG 18 `uuidv7()`, nullable org_id for pre-org auth events, `actor_type` CHECK constraint (coderabbit review finding — regenerated as one clean migration pre-merge). Hardening half (`feat/a4-auth-hardening`): Upstash-backed better-auth rate limits (secondary-storage counters, per-path customRules), Redis `secondaryStorage` with 5-method adapter (`services/redis/`), sessions mirrored to DB (`storeSessionInDatabase`) + `verification.storeInDatabase` (else the CLI drops the verification table), password policy = min 8 + first-party haveIBeenPwned plugin (fails closed, founder-accepted), login audit events (`auth.sign_in.succeeded/failed`, `auth.sign_up`, `auth.password_reset.requested/completed`) via first DAL module `src/server/dal/audit.ts`, cookie review (prefix `postory`, defaults accepted), Vercel IP headers for rate-limit keys, `member`-role rejection on all 4 org role paths. All verified live: HIBP 401 on breached pw, 11th sign-in → 429 + x-retry-after, `ba:*` keys in Upstash, audit rows in Neon, sign-out deletes Redis key, no-Redis dev fallback works. Earlier head start from A2: email verification required, sessions revoked on password reset, CSRF origin check (re-verified live during A4 — mutating org endpoints 403 without Origin), revocation UI at `/settings/security`*
- [x] A5. Drizzle schema + DAL with mandatory org scoping; better-auth tables integrated **(P0)** — *done 2026-07-16, merged to `master` in PR #6 (`feat/a5-schema-dal`). better-auth tables were integrated earlier (CLI-generated `src/db/schemas/auth.ts` + migrations, relations merged; `AuthCtx`/`getAuthCtx()` in `src/server/auth/context.ts`). This PR: all §4 domain tables + `credit_rates`, DAL foundation (org-scoped access, system ctx, mutation audit) — further DAL modules land with their epics. Review hardening 2026-07-16: composite ownership FKs across the org/brand/post graph (incl. new `post_platforms.brand_id`), stage↔decider CHECK on approvals, credit_ledger append-only PG triggers incl. TRUNCATE guard (custom migration; a5 migration regenerated in place pre-merge), `posts.current_version_id` composite-FK-bound to its own post via PG-15 column-list `ON DELETE SET NULL` (custom migration — drizzle can't express it, schema declares no FK for that column) — all constraints probe-tested on a throwaway PG 18*
- [x] A6. Env validation (zod), Sentry + Axiom, error conventions **(P0)** — *done 2026-07-17, PR #16 (`feature/a6-observability-error-conventions`) — pending human review (§13.1 auth gate + §13.9 Sentry config). Env validation landed earlier (@t3-oss/env-nextjs + zod, split `src/lib/env/{server,client}.ts`). This PR (3 tickets on one branch): **error conventions (ADR-013)** — `authorize(ctx, "resource:action")` coarse §7 gate wrapping the `permissions.ts` roles (throws `ForbiddenError`, `system` ctx bypass) + typed `Permission`; `withAction(schema, permission, handler)` RPC-style wrapper returning a typed `ActionResult` envelope (VALIDATION/DomainError/UNAUTHORIZED returned, unexpected → captureError+log then INTERNAL in prod / re-throw in dev), `src/server/actions/` + README. **Sentry** errors-only (`@sentry/nextjs` 10.66) — server/edge/client init merged into `instrumentation.ts` (env guards preserved) + `onRequestError` + branded `global-error.tsx`; `tracesSampleRate 0`, no Replay/Feedback, `sendDefaultPii false`; dormant without DSN, prod boot WARNs (gated by `shouldEnforceProductionEnv()`). **Axiom** via a transport-agnostic `log` helper (structured JSON → stdout → Vercel Log Drain, no dep/token) + `captureError(err,{ctx})` tagging org/member/role, both in `src/server/services/observability/`. Env: `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` optional in schema; build-time `SENTRY_ORG/PROJECT/AUTH_TOKEN` read via `process.env` in next.config (flagged). See Epic A progress log.*
- [ ] A7. App shell: brand sidebar, org switcher, credits meter, trial banner, empty states **(P0)** — *org switcher + user button live in the `(dashboard)` header; rest pending*
- [x] A8. **Authz test suite:** per-role access matrix tests incl. cross-org isolation (the ADR-002 security boundary) **(P0)** — *done 2026-07-16, merged 2026-07-17 as PR #9 (`test/a8-authz-suite`). Exhaustive §7 role×permission matrix (`tests/authz/role-matrix.test.ts` — every app-resource cell + org-admin guardrails, transcribed from §7 not derived from `permissions.ts`), mock-level DAL tenancy proof expanded onto shared fixtures (`tests/helpers/{ctx,db-mock}.ts`), convention doc (`tests/authz/README.md`). Two layers deferred as tracked `it.todo` (not silently dropped): live two-org Neon-branch behavioral tests (requires a seeded test DB + secrets — carry-over, pairs with the Playwright nightly) and the portal-token column (Epic E, no `PortalCtx` yet). Matrix proven non-tautological via an inject-a-grant/revert check*

#### Epic A progress log & carry-over reminders (added 2026-07-15, A2/A3 PR)

Done in the A2+A3 PR: better-auth **1.7.0-rc.1** instance (`src/server/auth/auth.ts`), role statements (`src/server/auth/permissions.ts` — single source of role truth), `AuthCtx` builder, Resend email service (`src/server/services/email/`), auth schema + migrations applied to Neon (squashed pre-merge into the single `20260715131216_rainy_reaper` — placeholder `tests` table gone), better-auth-ui vendored via shadcn registry, routes `/auth/[path]`, `/onboarding`, gated `/dashboard`, `/settings/[path]`, `/organization/[path]`.

**Merged 2026-07-15 as PR #2** after review. Post-review fixes on the branch: `(dashboard)` layout no longer swallows `ensureSession` failures (real backend errors surface instead of redirecting to sign-in); onboarding org-create wrapped in try/catch/finally (rejected requests set the error state, submit spinner always resets); `SKIP_ENV_VALIDATION` requires the exact value `"1"`; `EMAIL_FROM` promoted from a code constant to an env var (optional in dev with sandbox fallback, production **throws** on the sandbox sender). Also landed: stylelint (Tailwind-v4-aware) + VS Code workspace settings. Vendored better-auth-ui components deliberately kept byte-identical to the upstream registry.

**A1 PR (2026-07-15, merged as PR #3, `feat/a1-tooling-ci`):** Vitest 4.1.10 (`vitest.config.mts`, `unit` + `authz` projects, node environment, `@` alias + `server-only` stub, `SKIP_ENV_VALIDATION=1`), smoke suites in `tests/unit` (cn) and `tests/authz` (role-statement seed of the A8 matrix), Playwright 1.61 (`tests/e2e/smoke.spec.ts`, chromium, prod-build webServer), Prettier 3.9.5 + tailwindcss plugin (one-time format commit; `.prettierignore` protects vendored auth components, generated schema/migrations, `*.md`), ESLint boundary rules via core `no-restricted-imports` (negative-tested: alias + relative escapes both fire; `auth.ts` allowlisted), `.nvmrc` 22, `.github/workflows/ci.yml` merge gate. CI build proven locally with `.env` absent and dummy env only. Post-review fixes before merge: least-privilege CI token (`permissions: contents: read`, `persist-credentials: false`) and Playwright server reuse made opt-in (`PW_REUSE_SERVER=1`) so the prod-build smoke suite can't silently hit a stale dev server.

**A5 PR (2026-07-16, merged as PR #6, `feat/a5-schema-dal`):** Schema commit: all §4 domain tables + `credit_rates` (global config table — the documented exception to "every domain table carries org_id", flagged in PR notes), one schema file per domain area, shared column factories in `src/db/schemas/_helpers.ts` (uuid v7 PKs via Neon PG 18 `uuidv7()`, `orgId()` cascade FK, `memberRef()` nullable SET NULL attribution), CHECK-constrained status/enum vocabularies throughout; `posts.status` tokens are exactly the §5 state-machine states. Deliberate schema deviations from §4 (flagged in PR notes): no `posts.client_decision` ref (latest `approvals` row stage=`client` is the source of truth); `media_assets.type` split into `kind` (image/video) + `source` (upload/generated). DAL foundation: `AuthCtx` as a `MemberCtx | SystemCtx` union discriminated by role (`system` stays out of the user-facing `Role` type), `scope.ts` primitives (`orgScope()` returns non-optional SQL so the org predicate can't silently drop; `assertBrandAccess()` throws 404-shaped `NotFoundError`), first domain module `dal/brands.ts` (creator narrowing via `ctx.brandIds`), `getSystemCtx(orgId, jobName)` for jobs, mutation-audit helpers (`buildAuditInsert`/`recordAuditEvent`); mock-level authz tests assert every exported DAL query renders an org_id predicate bound to `ctx.orgId`. Review hardening (2 coderabbit rounds, commits `028094a` + `4d09268`): composite ownership FKs (8 parent `(…, id)` unique keys + 17 composite FKs incl. `posts_current_version_fkey`), new `post_platforms.brand_id`, stage↔decider CHECK, credit_ledger append-only triggers (UPDATE/DELETE/TRUNCATE; `pg_trigger_depth()` exempts org-cascade teardown). All validated per round on a throwaway PG 18 container: migrations applied in order + 15 behavioral probes (cross-org/cross-brand/cross-post inserts rejected, valid rows accepted, teardown cascade intact). **Deliberately NOT DB-enforced** (composite `SET NULL` would null the NOT NULL owner columns; drizzle 1.0.0-rc.4 can't emit PG-15 column-list `ON DELETE SET NULL` — the one exception, `posts.current_version_id`, is hand-written in the `posts_current_version_fkey` custom migration): all `memberRef()` attribution columns (`created_by`, `connected_by`, `decided_by_member_id`, `author_member_id`, `internal_approved_by`), `approvals.decided_by_token_id` / `comments.author_token_id` → portal_tokens, `media_assets.generation_job_id` → generation_jobs brand tie; plus `brand_members.member_id` org tie (better-auth `member` table — see carry-over). These stay DAL-enforced.

**A8 PR (merged 2026-07-17 as PR #9, `test/a8-authz-suite`):** Test-only PR — no auth/DAL/schema changes, so out of the §13 human-review hotspots (it *tests* them). Turned the three A5 "seed" suites into the full release-blocking matrix. New `tests/authz/role-matrix.test.ts`: data-driven over the 4 in-app roles × every app-resource action (`brand`/`account`/`post`/`ai`/`analytics`), asserted against an `EXPECTED` table transcribed by hand from the §7 matrix (deliberately NOT derived from `permissions.ts` — that would be tautological), plus org-administration guardrails (approver/creator denied every `defaultStatements` org/member/invitation/team/ac action; owner/admin allowed a representative subset). Shared fixtures extracted to `tests/helpers/{ctx.ts,db-mock.ts}` (DRY §4 — ctx factory + `PgDialect` select-mock were inlined in 3+ files; `vi.mock("@/db/db")` stays per-file since vitest hoists it). `tests/authz/dal-scoping.test.ts` refactored onto the helpers (all seed cases kept). `tests/authz/README.md` documents the "new DAL method/action → add matrix cases" convention (§11). Two layers deferred as tracked `it.todo` (visible-pending, not silently dropped): **live two-org Neon-branch behavioral tests** (needs seeded test DB + GitHub secrets — the carry-over below) and the **portal-token column** (Epic E, no `PortalCtx`/`dal/portal.ts` yet). Verified: `test:authz` 99 pass / 6 todo, full `test` 155 pass / 6 todo, `typecheck` + `lint` clean; matrix proven non-tautological by injecting `creator brand:["create"]` → exactly one cell failed, then reverted. `tests/unit/server/{context,audit-dal,dal-scope}.test.ts` still inline their own ctx factories (left untouched — no drive-by refactor, §12; could adopt `tests/helpers/ctx.ts` later — carry-over below). **Review round (commit `be3c8c2`):** added owner-only `organization:delete` assertions (owner allow + admin deny, outside the shared `ADMIN_GRANTS` loop); `memberCtx` default `creator` now uses a concrete assigned brand id (`["brand_1"]`) instead of `"all"` — the realistic creator shape, `"all"` is opt-in per call; prettier-formatted `role-matrix`; PRD wording ("requires a seeded test DB", standardized `pre-release`). Caught during that round: prettier had wrapped the `@ts-expect-error` type-guard onto a second line, detaching it from the `orgScope(...)` call and un-suppressing the intended compile error — fixed by extracting the ctx to a variable so the call stays adjacent (`typecheck` green). New counts after the round: `test` 157 pass / 6 todo (the two new `organization:delete` cases). Also surfaced during the round: `tests/unit/lib/env-runtime.test.ts` was failing `prettier --check` on `master` already (independent of this branch) — fixed pre-merge by the founder in `ac9cde6`.

**A6 PR (2026-07-17, PR #16, `feature/a6-observability-error-conventions` — pending review):** Env validation + Sentry + Axiom + error conventions. No schema migration (pure app/infra), one branch spanning three tickets (#13/#14/#15), each built test-first and reviewed on both axes (Standards + Spec) by parallel sub-agents before commit. **#13 (`authorize`, §13.1 hotspot):** `authorize(ctx, "resource:action")` in `src/server/auth/authorize.ts` — the coarse §7 gate wrapping the `permissions.ts` role objects (single source of role truth, not re-transcribed), throws the existing `ForbiddenError`, `system` ctx bypasses (§6.7); typed `Permission` string-union derived from `statement`. `tests/authz/authorize.test.ts` (release-blocking) + README row. **#14 (observability, §13.9 hotspot):** `@sentry/nextjs` 10.66 errors-only — per-runtime init (`sentry.{server,edge}.config.ts`, `instrumentation-client.ts`) merged into `instrumentation.ts` preserving the A4 redis/email env-guard imports, `onRequestError`, `withSentryConfig`, branded `src/app/global-error.tsx`; `tracesSampleRate 0`, no Replay/Feedback, `sendDefaultPii false`; init no-ops without a DSN, prod boot WARNs (never throws) gated by `shouldEnforceProductionEnv()`. Observability service `src/server/services/observability/`: `captureError(err,{ctx})` tags org/member/role (no PII) + transport-agnostic `log` (JSON→stdout→Axiom via a **Vercel Log Drain** — no dep, no token in bundle). `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` added optional to the t3 schema; **deviation (flagged):** build-time `SENTRY_ORG/PROJECT/AUTH_TOKEN` read via `process.env` in `next.config.ts`, not the schema (bundler tooling, app never reads them — `runtime.ts` precedent). Dropped `disableLogger` (deprecated + unsupported under Turbopack). **#15 (`withAction`, ADR-013):** `withAction(schema, permission, handler)` → RPC-style `(input: unknown) => Promise<ActionResult<T>>` (matches §7 template): parse → `getAuthCtx` → `authorize` → handler(data, ctx) → map; handler owns scoped fetch/domain/persist+audit/revalidate (wrapper does not). Error map: ZodError→VALIDATION+fieldErrors, DomainError→{code,message} (future Entitlement/Transition/InsufficientCredits map by code), UnauthorizedError→UNAUTHORIZED (not reported), unexpected→captureError+log then INTERNAL/dev-rethrow (no double-capture with onRequestError). `src/server/actions/{types,with-action,index}.ts` + README (contract + deferred `useActionState` `toFormAction` one-liner). Docs (§3): Sentry manual-setup for Next 16, Axiom send-data, better-auth 1.7.0-rc.1 access-control, zod ^4.4.3 `flattenError`. Verified per ticket: `typecheck` + `lint` clean, `test` 174 pass / 6 todo, production `build` green, `prettier --check` clean. Review fixes applied pre-commit: authz README row (#13), stale `withAction` comments reworded + deviation documented (#14), ADR-013's error-by-class list extended with the `UnauthorizedError` branch + a muddled comment reworded (#15).

**Carry-over — do later, don't forget:**
- [ ] **A6 follow-ups:** (1) configure the **Vercel → Axiom Log Drain** (dashboard, no code) so the structured `log` output actually lands in Axiom; (2) provision a Sentry project + set `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` (and build-time `SENTRY_ORG/PROJECT/AUTH_TOKEN` for source-map upload) in Vercel — until then Sentry is dormant/no-op; (3) enrich request-scope Sentry tagging so `onRequestError`/RSC errors carry org/member tags (deliberately kept out of `getAuthCtx` to avoid coupling the auth hotspot to Sentry); (4) `toFormAction(action)` adapter for `useActionState` lands with the first real form (Epic B/C — documented as a one-liner in `src/server/actions/README.md` for now); (5) route-level `error.tsx`/`not-found.tsx` + empty states are A7's charter (only the root `global-error.tsx` shipped in A6)
- [ ] Bump `better-auth` (+ `auth` CLI dev-dep + `@better-auth/drizzle-adapter`) from **1.7.0-rc.1 → 1.7.0 stable** when released; then **remove `.npmrc` `legacy-peer-deps=true`** (only needed because pre-release versions don't satisfy better-auth-ui's `>=1.6.19` peer ranges) and **remove the `kysely: ^0.28.17` pin** in package.json (kysely-adapter@rc imports root constants that kysely 0.29 moved to `kysely/migration`)
- [ ] Paste `GOOGLE_CLIENT_ID/SECRET` into `.env` (redirect URI `{BETTER_AUTH_URL}/api/auth/callback/google`) — Google button appears automatically, then verify the OAuth flow end-to-end
- [ ] Verify a sending domain in Resend and set the `EMAIL_FROM` env var to a verified-domain sender (it's an env var now, not a code constant; dev falls back to the sandbox `onboarding@resend.dev`, which delivers only to the account owner's address — production refuses to boot on the sandbox fallback)
- [ ] Browser pass of the real email links (verification + password reset) — API flows verified, inbox links not yet clicked
- [x] ESLint guardrails from AGENTS.md §6: `no-restricted-imports` confining `@/db/db` to the DAL (allowlist exception: `src/server/auth/auth.ts`, which the drizzle adapter requires) + lib↛server boundary rules — *done in the A1 PR (also catches relative-path escapes like `../db/db`)*
- [ ] `getAuthCtx()` returns `brandIds: "all"` placeholder — resolve from `brand_members` when B5 lands
- [x] better-auth's built-in `member` role string is still accepted by the invite **API** (plugin validation); it is never offered in the UI and maps to zero permissions — add an explicit rejection (hook or action-level guard) during A4/A8 — *done in A4: `assertAssignableRole()` in `permissions.ts`, wired into `organizationHooks` (invite create/accept, addMember, updateMemberRole); authz suite covers it; verified live (400 on `member` and `member,approver`)*
- [ ] `auth.ts` and `permissions.ts` intentionally omit `import 'server-only'` (the better-auth CLI rejects it during schema generation) — re-check on CLI upgrades whether the restriction is lifted. Schema regen runs via the existing `npm run auth:schema` script (an earlier note here wrongly claimed the script was dropped; only a duplicate `auth:generate` was)
- [ ] Clean up dev-DB test rows when convenient: users `delivered@resend.dev`, `delivered+approver@resend.dev`, `delivered+outsider@resend.dev`, `delivered+a4test@resend.dev` (A4); orgs "Acme Agency", "Rival Agency", "A4 Hardening Test Org"; pending invite to `delivered+a4invite@resend.dev`; A4 verification rows in `audit_log`
- [ ] Consider DB-level composite uniques on `member(organization_id, user_id)` and `account(provider_id, account_id)` during A5 — better-auth enforces these at the app layer and its CLI owns `src/db/schemas/auth.ts` (hand-edits get clobbered on regen), so this needs either an upstream schema request or a deliberate additive migration outside the generated file. Same bucket (A5 review, 2026-07-16): a `brand_members (org_id, member_id) → member(organization_id, id)` composite FK was skipped for the same reason — it needs a unique key on the better-auth `member` table; the org-consistency of `member_id` stays DAL-enforced until then
- [ ] **Before the next `npm run db:migrate` against dev Neon:** the A5 migration was regenerated twice pre-merge (final layout: `20260716090014_a5_domain_schema` + custom `20260716090015_credit_ledger_append_only` + custom `20260716090016_posts_current_version_fkey`). If an earlier folder name (`20260715183111…` or `20260716080457…`) was ever applied, drop the A5 domain tables + `credit_ledger_block_mutation()` and delete their drizzle-migrations rows (or reset the dev branch) first
- [ ] Revisit the A5 skip list (progress log above) on drizzle-orm upgrades: if a release adds PG-15 column-list `ON DELETE SET NULL`, the skipped composite ties become expressible in schema and the `posts_current_version_fkey` custom migration pattern can stop growing
- [ ] Repo uses **npm** (package-lock.json), not pnpm as older notes assumed; `src/db/schemas/` (plural) and split `src/lib/env/{server,client}.ts` are the canonical layouts — AGENTS.md to be reconciled
- [ ] Nightly + pre-release Playwright workflow (AGENTS.md §11): needs a seeded test DB (Neon branch) + GitHub secrets — local `npm run test:e2e` works today against `.env`. **Same seeded-DB infra unblocks the deferred A8 live two-org isolation tests** (the `it.todo` block in `tests/authz/dal-scoping.test.ts`) — the mock-level tenancy proof landed with A8; the behavioral defense-in-depth layer is what waits on this
- [ ] A8 follow-ups: **portal-token authz matrix cases** land with Epic E when `PortalCtx`/`dal/portal.ts` exist (`it.todo` placeholders in `tests/authz/role-matrix.test.ts`); every new DAL method/action must add matrix cases per `tests/authz/README.md`. Optional cleanup: point `tests/unit/server/{context,audit-dal,dal-scope}.test.ts` at the shared `tests/helpers/ctx.ts` factory (they still inline their own — left as-is to avoid a drive-by refactor)
- [ ] Vercel deploys currently fail at t3-env validation ("Invalid environment variables") — the Vercel project has no env vars set; its build command is `npm run db:migrate && npm run build`, so it also needs a real `DATABASE_URL` (+ `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, and `EMAIL_FROM` for production; **A4 adds `UPSTASH_REDIS_REST_URL/TOKEN` — required in production, the redis service throws at boot without them**). Part of the Phase-0 "deploy on merge" exit criterion
- [ ] A4 follow-ups: sessions created before the A4 deploy won't show in `/settings/security` (better-auth lists from the Redis `active-sessions-*` key only; they keep working and the list self-heals as sessions expire — pre-launch non-issue). `session.cookieCache` deliberately not enabled (perf, not hardening — revisit if session-lookup latency matters). Portal-token endpoints (Epic E) must state their own rate-limit rules when they land (AGENTS.md §7). On https preview/prod, spot-check the cookie is `__Secure-postory.session_token` with HttpOnly/Secure/SameSite=Lax (dev is http, so only the base name is checkable locally — done)
- [ ] Optional: bump `@types/node` `^20` → `^22` to match `.nvmrc` (Node 22 in CI)

### Epic B — Brands & social accounts (P0)
- [x] B1. Brand CRUD (create + update) — Zernio profile provisioning moved to B3 (ADR-009 amended: lazy, on first account placement) **(P0)** — *done 2026-07-17. **B1.1 Create** merged as PR #20 (`feat/b1.1-brand-create`, closes #18); **B1.2 Edit** merged as PR #21 (`feat/b1.2-brand-edit`, closes #19). Scope: name + timezone only (logo/colors/`requires_client_approval` deferred to their consuming epics; voice profile + client-contact are B2); slug auto-derived + immutable, routing by id; timezone IANA-validated server-side; entitlement/plan cap deferred to B4 (`// TODO(B4)` seam). No Zernio call, no migration. See Epic B progress log.*
- [x] B2. Brand voice profile (feeds all AI) + client contact email (for approval/report links) **(P0)** — *done 2026-07-17, merged as PR #24 (`feat/b2-brand-voice-contact`, #22 spec / #23 ticket). Two owner/admin-only settings sections: voice profile (optional tone + banned words + flat brand hashtags + sample posts; JSONB, all-empty → null; feeds AI in Epics C/D) + single optional validated client contact email. Shared `applyBrandUpdate` atomic org+id-scoped update+audit helper (B1's updateBrand refactored onto it); distinct PII-safe audits (`brand.voice.update` / `brand.contact.update` — client email value never in metadata); shared `linesToList`/`parseHashtags` (`src/lib/text.ts`) used by inputs + server schema. No migration. Permission `brand:update`. See Epic B progress log.*
- [ ] B3. Connect accounts via Zernio OAuth (6 launch platforms); overflow-profile auto-create on same-platform duplicates; connection health + reconnect prompts **(P0)** — *now also owns primary-profile provisioning (`POST /api/v1/profiles`) — moved here from B1 by the ADR-009 lazy amendment*
- [ ] B4. Entitlement enforcement (brands/accounts/seats/credits) + trial caps + upgrade CTAs **(P0)** — *B1.1 left a `// TODO(B4)` seam in `dal/brands.ts` createBrand where the brand-count cap check will go*
- [ ] B5. Per-brand member access (`brand_members`) — creators see assigned brands only **(P0 — raised from P1: core to agency ICP)**

#### Epic B progress log & carry-over (added 2026-07-17, B1.1 + B1.2)

**B1 design workflow (2026-07-17):** grilled the design (/grill-with-docs + /domain-modeling), wrote the spec as GitHub issue **#17**, decomposed into two tracer-bullet slices — **#18** (Create, no blockers) and **#19** (Edit, `blocked_by` #18 via GitHub's native issue-dependency API). Produced repo-root **`CONTEXT.md`** (project glossary: Organization / Brand / Member / Client / Zernio Profile / Social Account / Platform, each with an `_Avoid_` list) and **amended ADR-009** (§3) to lazy profile provisioning — the key decision: creating a Brand does NO Zernio work (a brand with zero accounts has no `zernio_profiles` row), so B1 is a pure-local mutation and the one Zernio call moves to B3. Slug auto-derived + immutable (routing by id); Create + Update only (archive deferred — needs a migration + B4/ADR-010 read-only semantics).

**B1.1 PR (2026-07-17, merged as PR #20, `feat/b1.1-brand-create`, closes #18):** Pure-local, no migration. TDD at two pre-agreed seams. **Pure foundation:** `slugify` + `dedupeSlug` (`src/server/domain/brand-slug.ts` — diacritic-fold, gap-filling case-insensitive dedupe), `src/lib/timezones.ts` (`supportedTimeZones`, `isValidTimeZone`), `src/lib/validation/brands.ts` (`createBrandSchema` — name trimmed 2–80, IANA timezone). **DAL** `createBrand` (`dal/brands.ts`): org_id from ctx (never input), org-scoped slug-dedupe read backed by the `(org_id, slug)` unique index, paired `brand.create` audit carrying the created fields as the diff (§6.6); `tests/helpers/db-mock.ts` extended with `captureInserts` + a thenable select chain. **Action** `createBrand` via `withAction("brand:create")` (`src/server/actions/brands.ts` — first feature action). **UI:** `/brands` list page (server component) + "New brand" `AlertDialog` (timezone Combobox, browser-tz smart default), dialog hidden for non-owner/admin (UX only; the authorize gate is enforcement). Reused `withAction`/`recordAuditEvent`/the authz role-matrix (brand:create already covered); `slugify` kept distinct from the client `sanitizeSlug`. **Two-axis code-review** (Standards + Spec parallel sub-agents) pre-commit + a PR review round (commit `a4705d7`): role-gated the dialog, added "UTC" to the timezone options (`Intl.supportedValuesOf` omits it), wrapped submit in try/catch/finally. Verified: `typecheck` + `lint` (0 errors) + `format:check` clean, `test` **190 pass / 6 todo**, production `build` green. **Deviations (flagged in PR notes):** audit action is `brand.create` (matches the canonical `dal/audit.ts` + `orgAuditEventSchema` example), not the ticket's loose `brand.created`; timezone validated via `Intl.DateTimeFormat` (accepts the `UTC` DB fallback that `supportedValuesOf` omits), not list membership. Fixed the stale `zernio_profiles` schema comment to match lazy provisioning.

**B1.2 PR (2026-07-17, merged as PR #21, `feat/b1.2-brand-edit`, closes #19):** Edit a Brand's name + timezone; slug immutable; no migration. TDD at the same two seams. **DAL** `updateBrand` (`dal/brands.ts`): org+id-scoped update paired with a `brand.update` audit in one atomic `db.batch` (Case A, `dal/audit.ts`); `slug` never in `.set()`; 0-row → `NotFoundError`. **Action** `updateBrand` via `withAction("brand:update")` — does the §7 step-4 scoped fetch (`getBrandById`) so cross-org/nonexistent ids 404 before any write (the DAL org+id scope is belt-and-suspenders, §6.4). **UI:** `/brands/[brandId]/settings` page (edit form for owner/admin, read-only for other readers); list cards now link to settings. **Reuse (§4 rule-of-two):** extracted a shared `BrandTimezoneField` + `timeZoneOptions` (`src/lib/timezones.ts`; create dialog refactored onto them, "UTC" centralized) and a **`useActionForm` hook** (`src/hooks/use-action-form.ts`) that centralizes the ADR-013 `ActionResult` envelope handling — both brand forms use it. `updateBrandSchema` composes `createBrandSchema.extend({ id })`; `db-mock` extended with `captureUpdate`/`makeBatch`/`renderedSql`. **Two-axis code-review** (Standards + Spec parallel sub-agents): no blockers; the one rule-of-two finding (duplicated submit boilerplate) was resolved by extracting `useActionForm` before commit. Verified: `typecheck` + `lint` (0 errors) + `format` clean, `test` **195 pass / 6 todo**, production `build` green. **Deviations (flagged):** permission `brand:update` (per `permissions.ts`), NOT the ticket's `brand:edit`; audit action `brand.update`, not `brand.updated`; audit `metadata` records the new `{name,timezone}` (consistent with `createBrand`), not a literal before/after diff of only-changed fields (a true diff would need the pre-image threaded through — deferred).

**B2 PR (2026-07-17, merged as PR #24, `feat/b2-brand-voice-contact`, #22 spec / #23 ticket):** Brand voice profile + client contact — two owner/admin-only settings sections, no migration. **Schema/validation** (`lib/validation/brands.ts`): `voiceProfileSchema` (tone ≤500 free-text; bannedWords ≤100/≤50 each; hashtags ≤30, `#`-stripped, `[A-Za-z0-9_]`, deduped; samplePosts ≤10/≤2000 each; all-empty → `null`), `updateBrandVoiceSchema` / `updateBrandContactSchema` (email optional + clearable); pure `linesToList`/`parseHashtags`/normalizers in `src/lib/text.ts` shared by the client inputs and the server `.transform()` so preview and stored value agree. **DAL:** shared `applyBrandUpdate(ctx, brandId, set, audit)` (atomic org+id-scoped `db.batch(update + audit)`, 0-row `NotFoundError`) — B1's `updateBrand` refactored onto it; `updateBrandVoice` / `updateBrandContact` each write only their own column. **Actions** via `withAction("brand:update")` + §7 scoped fetch (cross-org/unassigned 404 before write). **Audit:** distinct `brand.voice.update` (`{fields}`) / `brand.contact.update` (`{set|cleared}`) — the client email value is never in metadata (§7 PII). **UI:** settings page grows Voice + Contact sections (read-only for non-editors), sample posts as repeatable rows; reuses `useActionForm`. **Two-axis review** (Standards + Spec): no blockers; applied notes (renamed `toList`→`linesToList`; drop blank tone; per-row `aria-label` on sample posts; broadened the creator-reject DAL test to cover contact) — **skipped** a DAL-level owner/admin role check (redundant with the §7 `authorize("brand:update")` gate every caller runs; would diverge from the createBrand/updateBrand pattern and couple the DAL to the permission system — a §13 hotspot change not warranted). Verified: `typecheck` + `lint` (0 errors) + `format` clean, `test` **213 pass / 6 todo**, `build` green. Glossary: `CONTEXT.md` gains Voice Profile + Brand Hashtags.

**Carry-over — do later, don't forget:**
- [ ] **Archive/delete a Brand** — deliberately out of B1 (needs a `status`/`archived_at` migration + B4 downgrade-read-only / ADR-010 trial semantics to define what "archived" restricts). File as its own task alongside B4.
- [ ] Brand-scoped member narrowing for creators still pending B5 (`getAuthCtx` returns `brandIds: "all"`); `listBrands`/`updateBrand` already honor `ctx.brandIds` once populated.
- [ ] Brand UI (create dialog, edit form, list, settings page) not driven in a browser — same deferred seeded-DB/session infra as the A8 live tests + Playwright nightly; the slices are proven via the seam tests + build. Good first golden-path E2E target once that infra lands.
- [ ] `useActionForm` (`src/hooks/use-action-form.ts`) is the shared form↔`ActionResult` glue used by every brand form (B1 + B2). Still open: reconcile the stale `toFormAction`/`useActionState` note in `src/server/actions/README.md`, which predates the hook.
- [ ] Next Epic B work: **B3** (Zernio account connection — where lazy profile provisioning per ADR-009 actually lands), **B5** (per-brand member access — resolves the `getAuthCtx` `brandIds:"all"` placeholder), **B4** (entitlement enforcement — blocked on Stripe/trial from Epic H + ADR-010; `// TODO(B4)` seam already in `dal/brands.ts`).

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

- [x] **`CLAUDE.md` / agent rules file** at repo root covering: stack versions + Next 16 conventions (`proxy.ts`, awaited params, `"use cache"` policy), DAL-only DB access, "every domain query takes `orgId`", state-machine/ledger changes require tests-first, zod at every boundary, no new deps without note in PR description, file/module layout map. — *done: `CLAUDE.md` → `AGENTS.md` (§2 stack, §3 Next-16 gotchas, §5 layout map, §6 DAL, §9 zod/deps, §11 tests-first)*
- [x] **Vendor context for agents:** pin links in the rules file — Next.js `/docs/llms.txt`, Zernio `docs.zernio.com` (llms.txt + OpenAPI), better-auth docs, Stripe docs, OpenRouter docs (`openrouter.ai/docs`; image model catalog via `/api/v1/images/models`). Optionally wire Zernio's MCP server + Next.js DevTools MCP into the coding environment. — *done: AGENTS.md §2 table pins all doc entry points; optional MCP wiring not set up (revisit if needed)*
- [x] **Work-order discipline:** implement from this PRD's checkboxes; one checkbox ≈ one PR-sized task with acceptance criteria; agents never combine schema migrations with business-logic changes in one task. — *done: AGENTS.md §12; practiced in PRs #2 (A2/A3) and #3 (A1)*
- [ ] **Test gates the agent must satisfy:** state machine, entitlements, credit ledger, authz matrix — unit tests exist before implementation changes merge; golden-path E2E runs in CI nightly. — *partial: gates defined in AGENTS.md §11; unit + authz suites run in the merge gate since A1 (PR #3). Remaining: the domain suites themselves (land tests-first with their modules) + nightly golden-path E2E (carry-over, pairs with A8)*
- [x] **Human-review hotspots** (never auto-merge): auth config, DAL, webhook verification, Stripe amounts, anything touching `credit_ledger`. — *done: AGENTS.md §13 list; PRs #2/#3 human-reviewed and merged by the founder*

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
