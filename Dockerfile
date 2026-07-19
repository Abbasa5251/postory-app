# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the POSTORY Next.js 16 app (next.config.ts sets
# output: "standalone"). Base image: node:22-slim (Debian/glibc) — matches
# .nvmrc (22) and is lower-risk for native modules (Turbopack / @next/swc,
# sharp) than musl/alpine. Pin by digest in production, e.g.
#   FROM node:22-slim@sha256:<digest> AS deps
#
# Build for the deploy host's architecture (e.g. on Apple Silicon targeting an
# amd64 host: `docker buildx build --platform linux/amd64 ...`) so the correct
# Turbopack/@next/swc native binding is installed.

########## deps: full install (incl. devDeps — the build needs them) ##########
FROM node:22-slim AS deps
WORKDIR /app
# .npmrc carries legacy-peer-deps=true (required for the better-auth RC peer set).
COPY package.json package-lock.json .npmrc ./
# NO NODE_ENV=production here: that would omit devDependencies
# (babel-plugin-react-compiler, tailwind, tsc, tsx) and break the build.
RUN npm ci

########## builder: compile the standalone bundle ##########
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# @t3-oss/env-nextjs validates on import during `next build`; runtime secrets
# aren't present at build time, so skip validation here. Any NEXT_PUBLIC_* that
# varies per environment would instead need to be a real build ARG (it is
# inlined into the client bundle at build) — none vary today (see .env.example).
ENV SKIP_ENV_VALIDATION=1
# The only NEXT_PUBLIC_* var (audited): the Sentry browser DSN. It is inlined
# into the client bundle at build, so it must be present HERE, not at runtime.
# Optional (the client SDK no-ops without it) and not a secret. Pass with
# `docker build --build-arg NEXT_PUBLIC_SENTRY_DSN=...`.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
# Sentry source-map upload is opt-in: mount the token as a BuildKit secret so it
# never lands in an image layer. Absent token => upload silently skipped, build
# still succeeds. Pass at build with:
#   docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN ...
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build

########## migrate: one-shot deploy-time migration runner ##########
# Keeps the full node_modules (tsx + drizzle-orm + pg) and the SQL files, which
# the standalone runner deliberately omits. Invoked as the `migrate` compose
# service, gated ahead of the app by service_completed_successfully.
FROM node:22-slim AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=builder /app/src/db/migrations ./src/db/migrations
USER node
# migrate.ts imports only pg + drizzle-orm + dotenv (no @/ path aliases), so tsx
# runs it directly — no separate compile step.
CMD ["node_modules/.bin/tsx", "src/db/migrate.ts"]

########## runner: minimal standalone server ##########
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# standalone bundles a minimal server.js + traced node_modules; .next/static and
# public/ are NOT traced and must be copied explicitly (or the UI 200s with no
# CSS/JS/assets).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER node
EXPOSE 3000
# Graceful shutdown (SIGTERM drain + Next after() callbacks) is bounded by the
# compose stop_grace_period.
CMD ["node", "server.js"]
