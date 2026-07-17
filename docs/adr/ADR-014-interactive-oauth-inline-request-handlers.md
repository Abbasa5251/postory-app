---
status: accepted
---

# ADR-014 — Interactive Zernio OAuth runs inline in request handlers (carve-out from ADR-003)

## Context

ADR-003 says all generation and publishing work is async via Inngest — "No AI/publish
call in a request handler," and AGENTS.md §16 lists "AI/publish/network call inside a
request handler instead of an Inngest job" as an instant-reject anti-pattern. B3 connects
social accounts through Zernio's OAuth flow, which is inherently **interactive and
synchronous**: when a Member clicks "Connect Instagram," we must (lazily provision the
Brand's Zernio profile if it has none, then) call `GET /v1/connect/{platform}?profileId=…`,
receive an `authUrl`, and redirect the browser to it **in the same request** — the user is
waiting on the redirect. Deferring that to a background job and polling for the `authUrl`
adds latency and moving parts to a redirect that must happen now.

## Decision

The two **interactive OAuth touchpoints** — connect-initiation and the OAuth callback — run
**inline in request handlers** (route handlers / server actions), the same way better-auth's
own `/api/auth/*` routes already make external calls inline. Specifically, inline calls are
permitted for: lazy `POST /v1/profiles` provisioning (once per Brand), `GET /v1/connect/{platform}`
(fetch `authUrl` + redirect), and the callback's `GET /v1/accounts` read that persists the
connected Social Account.

ADR-003's rule is scoped — correctly — to **generation and publishing workloads** (expensive,
retriable, per-org-concurrency-bounded AI and publish jobs). A sub-second, user-blocking OAuth
handshake is neither, and forcing it through Inngest would degrade the interaction for no
robustness gain. Everything **heavy or async** stays in Inngest per ADR-003: connection-health
refresh, disconnection handling, the reconciliation sweep, and (from F3 onward) all Zernio
webhook processing.

## Considered options

- **Enqueue an Inngest job to fetch the `authUrl`, UI polls, then redirects.** Rejected: keeps
  ADR-003 literal but adds a polling round-trip and job lifecycle to an interactive redirect,
  with no reliability benefit — the user is present and waiting either way.
- **Persist the connected account via the `account.connected` webhook instead of the inline
  callback read.** Deferred to F3, not adopted for B3: it would pull the §13 webhook
  signature-verification hotspot into B3 and half-duplicate the skeleton F3 is chartered to
  build. B3 persists synchronously on the callback and self-heals drift by reconciling against
  `GET /v1/accounts` on every accounts-page load.

## Consequences

- Request handlers doing Zernio OAuth calls must still respect §7: validate input, build
  `AuthCtx` / authorize (`account:connect`), scope to the Brand, and audit. The callback carries
  a signed `state` for CSRF protection and Brand correlation.
- This carve-out is **narrow**: it authorizes inline external calls for the OAuth handshake only.
  Any temptation to run generation/publish/analytics calls inline still violates ADR-003.
- An abandoned OAuth flow can leave an **empty Zernio profile** (zero accounts). This is harmless
  (profiles are free; Zernio bills per account-day) and is reused on the next connect attempt —
  profile creation is reuse-if-exists.
