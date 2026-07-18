# Local Docker stack

A fully self-contained POSTORY environment with **no third-party services and
no proxies**. The two cloud dependencies are replaced by plain containers that
the app talks to directly over their standard wire protocols:

| Cloud service | Local replacement | Driver (direct, no proxy)              |
| ------------- | ----------------- | -------------------------------------- |
| Neon Postgres | `postgres:18`     | `drizzle-orm/node-postgres` (`pg`)     |
| Upstash Redis | `redis:7`         | `ioredis`                              |

Both drivers speak the standard wire protocols, so the same code also runs
against Neon/Upstash (or any Postgres/Redis) in production via their direct
connection strings — the vendor SDKs (`@neondatabase/serverless`,
`@upstash/redis`) are gone entirely.

Postgres 18 is required (not 15/16) — domain tables default their PKs with the
native `uuidv7()`, which ships in Postgres 18.

## Quick start

```bash
docker compose up --build          # build + start the whole stack
# app  → http://localhost:3000
```

The `migrator` service runs `drizzle-kit migrate` once and exits; the `app`
service starts only after it completes successfully.

```bash
docker compose down                # stop
docker compose down -v             # stop + wipe the postgres/redis volumes
docker compose logs -f app         # tail the app
docker compose run --rm migrator   # re-run migrations by hand
```

## Services

| Service    | Image                | Host port | Purpose                                            |
| ---------- | -------------------- | --------- | -------------------------------------------------- |
| `postgres` | `postgres:18-alpine` | 5432      | Primary datastore                                  |
| `redis`    | `redis:7-alpine`     | 6379      | Sessions (secondary storage) + rate-limit counters |
| `migrator` | built (`migrator`)   | —         | One-shot `drizzle-kit migrate`, then exits         |
| `app`      | built (`runner`)     | 3000      | Next.js standalone server                          |

## How the wiring works

- **DB:** the app's `DATABASE_URL` points straight at `postgres:5432`.
  `src/db/db.ts` uses `drizzle-orm/node-postgres`, which opens a normal pooled
  TCP connection. The mutation+audit atomicity in the DAL uses real
  `db.transaction()` (see `src/server/dal/audit.ts`).
- **Redis:** the app's `REDIS_URL` points at `redis://redis:6379`.
  `src/server/services/redis/client.ts` uses `ioredis`; the better-auth
  secondary-storage adapter issues `GET`/`SET`/`DEL`/`GETDEL` and the Lua
  `EVAL` increment directly.
- **Migrations:** `drizzle-kit` (with the `pg` driver) connects directly to
  `postgres:5432`.

## Configuration

Every value defaults to zero-config local dev. Override any of them via a
sibling `.env` file or shell variables (compose reads `${VAR:-default}`):
`POSTGRES_USER/PASSWORD/DB`, `APP_PORT`, `POSTGRES_PORT`, `REDIS_PORT`,
`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ZERNIO_API_KEY`,
`GOOGLE_CLIENT_ID/SECRET`.

## Not replaced locally

These have no self-hostable emulator and stay as external calls (all optional
at boot — the services fail lazily only when actually invoked):

- **Resend** (email) — HTTP API, no local emulator. A dummy `RESEND_API_KEY`
  and a non-sandbox `EMAIL_FROM` satisfy the production boot guards; real sends
  no-op locally.
- **Zernio** (publishing), **Google OAuth**, **Sentry** — unset by default.
