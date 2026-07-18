# Self-hosted deployment (Docker)

POSTORY ships as a containerized Next.js 16 standalone server. This describes
the single-host deployment: the app + Redis + reverse proxy run in Docker
Compose; **Postgres stays managed** (Neon / a managed PG).

## Topology

| Service | Image / target | Role | Ports |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination + reverse proxy → `app:3000` | 80, 443 (only public) |
| `app` | Dockerfile `runner` | Next.js standalone server (`node server.js`) | internal |
| `migrate` | Dockerfile `migrate` | one-shot `drizzle` migrator, gates the app | internal |
| `srh` | `hiett/serverless-redis-http` | Upstash-REST façade over Redis | internal |
| `redis` | `redis:7-alpine` | session cache + auth rate-limit counters (AOF) | internal |

Postgres is **not** a compose service — `DATABASE_URL` points at the managed
instance (must be **PG18+**: the schema uses native `uuidv7()`).

## Architecture decisions (why it's built this way)

- **node-postgres driver** ([src/db/db.ts](../src/db/db.ts)) instead of the Neon
  HTTP serverless driver: a long-lived container is better served by a
  persistent TCP `Pool`, and it gives interactive transactions (the audit
  atomicity template + the migrator rely on them).
- **SRH for Redis**: the app's `@upstash/redis` client speaks the Upstash REST
  API. SRH exposes that API over a real Redis, so self-hosting Redis needs
  **zero app code change** — only the `UPSTASH_REDIS_REST_URL/TOKEN` values
  move. (Portability bonus: switch back to managed Upstash by changing two env
  vars.)
- **One-shot migrate service, not a per-app-boot entrypoint**: the drizzle
  migrator takes no advisory/table lock, so running it from every app replica
  would race the same DDL. A single `migrate` service gated by
  `service_completed_successfully` is a single migration actor with a clean
  exit code that gates rollout. ([src/db/migrate.ts](../src/db/migrate.ts) also
  takes a defensive `pg_advisory_lock` so manual re-runs are safe too.)

## Environment

Two committed example files (no secrets), each copied to a gitignored real file
on the host:

- `deploy.env.example` → `deploy.env` — compose interpolation
  (`REDIS_PASSWORD`, `SRH_TOKEN`, `APP_DOMAIN`). Passed with `--env-file`.
- `.env.production.example` → `.env.production` — app + migrate runtime secrets
  (`DATABASE_URL`, `BETTER_AUTH_SECRET/URL`, the SRH-backed `UPSTASH_*` pair,
  `EMAIL_FROM`, `RESEND_API_KEY`, `ZERNIO_API_KEY`, …).

Rules that bite:

- `UPSTASH_REDIS_REST_URL=http://srh:80` and `UPSTASH_REDIS_REST_TOKEN` (=
  `SRH_TOKEN`) and `EMAIL_FROM` are **required at runtime** — the ADR-011 boot
  guard ([src/instrumentation.ts](../src/instrumentation.ts)) throws at startup
  otherwise (no `VERCEL=1` in Docker, so runtime enforcement fires).
- `SKIP_ENV_VALIDATION=1` is set **only during `next build`** (the Dockerfile
  builder), because runtime secrets aren't present at build time.
- `NEXT_PUBLIC_SENTRY_DSN` (the only `NEXT_PUBLIC_*`) is inlined at build — pass
  it as `--build-arg NEXT_PUBLIC_SENTRY_DSN=...`, never as a runtime var.
- `SENTRY_AUTH_TOKEN` (source-map upload) is a **BuildKit secret**, not an
  ARG/ENV: `--secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN`. Absent → upload
  is skipped, build still succeeds.

## Deploy flow

```bash
# 1. Prepare host env files (once)
cp deploy.env.example deploy.env                 # fill REDIS_PASSWORD, SRH_TOKEN, APP_DOMAIN
cp .env.production.example .env.production        # fill DB/auth/redis/email/zernio

# 2. Build (target the host arch; on Apple Silicon → amd64 host add --platform)
docker compose --env-file deploy.env build
#   with Sentry source maps + browser DSN:
#   docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
#                --build-arg NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN ...

# 3. Up — migrate runs to completion, THEN app starts, THEN caddy
docker compose --env-file deploy.env up -d

# 4. Watch
docker compose logs -f migrate    # confirm "migrations applied" and exit 0
docker compose logs -f app        # confirm boot (guard satisfied)
```

## Operational notes

- **Single replica.** Scaling `app` to >1 requires `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`,
  a shared Redis `cacheHandler` (`cacheMaxMemorySize: 0`), and a stable
  build ID/`deploymentId` — none configured yet. Do that as its own change
  before scaling.
- **Redis durability.** Sessions live in Postgres (`storeSessionInDatabase`), so
  a Redis flush only drops cache + in-flight rate-limit counters. AOF is enabled
  for convenience, not correctness.
- **Backups** are the managed Postgres provider's responsibility here — there is
  no local PG volume to back up.
- **SRH caveat.** Upstash positions SRH for dev/CI/internal use; it is kept off
  the public network (no published ports), behind a strong `SRH_TOKEN` and Redis
  password. Auth rate limiting fails **closed**, so smoke-test the sign-in path
  after any Redis/SRH change (see `tests/` SRH smoke coverage).
