# Zernio service

The only module that speaks Zernio's wire format (publishing sibling of the
OpenRouter service; ADR-012 ethos). Base URL `https://zernio.com/api/v1`, Bearer
`ZERNIO_API_KEY` (lazy — unset only fails at first real call).

## Wire-shape provenance (AGENTS.md §3)

Confirmed from `docs.zernio.com` examples:

- `GET /v1/connect/{platform}?profileId=…` → `{ authUrl }`
- `POST /v1/profiles` (body `{ name }`) → `{ profile: { _id, name, description } }`
- `GET /v1/accounts?profileId=…` → `{ accounts: [{ _id, platform, … }] }`

Zernio ids are `_id`. Responses are **not** wrapped in a `data` key (that was a
variable name in the docs' JS examples).

## ⚠️ VERIFY before B3 ships (assumptions, not confirmed by docs)

1. **Account display fields** — the docs show `_id` + `platform` on an account
   but not the username/handle/avatar field names. `normalizeAccount` accepts
   several candidates (`username`/`handle`/`displayName`/`name`,
   `picture`/`avatar`/`avatarUrl`) and falls back to `_id`. Tighten once the
   real names are known.
2. **Account-health response** — path (`/accounts/health`) and shape are
   best-effort. Modeled as `{ accounts: [{ _id, canPost?, status? }] }`;
   `healthToStatus` maps it to `connected | needs_reauth`.
3. **Disconnect** — verb/path best-effort (`DELETE /accounts/{id}`). 404 is
   swallowed (idempotent).
4. **Connect callback / `redirectUrl`** — whether Zernio honors a `redirectUrl`
   query param vs. a dashboard-configured callback is unconfirmed. The B3 flow
   does not depend on Zernio echoing state: it uses a signed state cookie
   (`oauth-state`) to correlate the callback to the originating brand.

`.passthrough()` + optional unions mean an unexpected present field never
throws; a missing documented-required field (`_id`, `platform`, `authUrl`) still
fails loudly via zod.
