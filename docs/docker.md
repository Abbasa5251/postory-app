# Local Docker stack

A fully self-contained POSTORY environment. It replaces the two cloud
dependencies with protocol-compatible local containers so **the application
code runs unchanged**:

| Cloud service      | Local replacement                                    | How the app still works unchanged                                                                 |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Neon Postgres      | `postgres:18` + `local-neon-http-proxy`              | The `drizzle-orm/neon-http` driver + `db.batch()` atomicity keep working; the proxy speaks Neon's HTTP wire protocol in front of a plain Postgres. |
| Upstash Redis      | `redis:7` + `serverless-redis-http` (SRH)            | The `@upstash/redis` client is unchanged; SRH exposes the Upstash REST API (incl. `eval`/`getdel`) in front of a real Redis. |

Postgres 18 is required (not 15/16) — domain tables default their PKs with the
native `uuidv7()`, which ships in Postgres 18.

## Quick start

```bash
docker compose up --build          # build + start the whole stack
# app  → http://localhost:3000
```

The `migrator` service runs `drizzle-kit migrate` once (connecting straight to
Postgres over the wire protocol, not through the neon proxy) and exits; the
`app` service starts only after it completes successfully.

```bash
docker compose down                # stop
docker compose down -v             # stop + wipe the postgres/redis volumes
docker compose logs -f app         # tail the app
docker compose run --rm migrator   # re-run migrations by hand
```

## Services

| Service      | Image                                          | Host port | Purpose                                            |
| ------------ | ---------------------------------------------- | --------- | -------------------------------------------------- |
| `postgres`   | `postgres:18-alpine`                           | 5432      | Primary datastore                                  |
| `neon-proxy` | `ghcr.io/timowilhelm/local-neon-http-proxy`    | 4444      | Neon HTTP wire protocol → Postgres                 |
| `redis`      | `redis:7-alpine`                               | 6379      | Sessions (secondary storage) + rate-limit counters |
| `srh`        | `hiett/serverless-redis-http:0.0.10`           | 8079      | Upstash REST API → Redis                           |
| `migrator`   | built (`migrator` target)                      | —         | One-shot `drizzle-kit migrate`, then exits         |
| `app`        | built (`runner` target)                        | 3000      | Next.js standalone server                          |

## How the wiring works

- **DB:** the app sets `USE_LOCAL_NEON_PROXY=true`, so `src/db/db.ts` points
  `neonConfig.fetchEndpoint` at `http://neon-proxy:4444/sql`. The app's
  `DATABASE_URL` host (`neon-proxy`) is only used as the fetch-endpoint routing
  key; the proxy itself connects to Postgres via its own `PG_CONNECTION_STRING`.
- **Redis:** the app points `UPSTASH_REDIS_REST_URL` at `http://srh:80` with
  `UPSTASH_REDIS_REST_TOKEN` matching SRH's `SRH_TOKEN`.
- **Migrations** bypass the proxy: `drizzle-kit` uses a standard Postgres TCP
  connection, so the `migrator` service's `DATABASE_URL` points directly at
  `postgres:5432`.

## Configuration

Every value defaults to zero-config local dev. Override any of them via a
sibling `.env` file or shell variables (compose reads `${VAR:-default}`):
`POSTGRES_USER/PASSWORD/DB`, `APP_PORT`, `POSTGRES_PORT`, `REDIS_PORT`,
`NEON_PROXY_PORT`, `SRH_PORT`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
`EMAIL_FROM`, `ZERNIO_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`.

## Not replaced locally

These have no self-hostable emulator and stay as external calls (all optional
at boot — the services fail lazily only when actually invoked):

- **Resend** (email) — HTTP API, no local emulator. A dummy `RESEND_API_KEY`
  and a non-sandbox `EMAIL_FROM` satisfy the production boot guards; real sends
  no-op locally.
- **Zernio** (publishing), **Google OAuth**, **Sentry** — unset by default.
