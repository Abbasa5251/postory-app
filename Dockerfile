# syntax=docker/dockerfile:1

# POSTORY container image — multi-stage.
#   deps     → install the full dependency tree once (cached layer)
#   builder  → `next build` into the standalone output
#   migrator → drizzle-kit migrate (devDeps + source; connects straight to
#              Postgres over the wire protocol, NOT through the neon proxy)
#   runner   → slim runtime: only the traced standalone server + static assets
#
# Node pinned to the repo's .nvmrc (22).

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
# .npmrc carries `legacy-peer-deps=true`, required by the RC-versioned stack.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---------- builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build must never touch real infra or require deploy secrets. t3-env's
# escape hatch (exact "1") skips runtime env validation; the Sentry bundler
# plugin no-ops without SENTRY_AUTH_TOKEN. Produces .next/standalone.
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` collects page data by evaluating each route module top-level,
# which constructs the neon-http client — `neon()` PARSES the connection string
# eagerly (it only opens a connection lazily, on the first query, which build
# never does). A syntactically valid placeholder lets that parse succeed with
# no DB present. Build-stage only: the runtime DATABASE_URL is injected by
# compose and never inherits this value.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

# ---------- migrator ----------
# Applies drizzle-kit migrations against Postgres. Kept as a dedicated target
# so docker-compose can run it as a one-shot job before the app starts.
FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts tsconfig.json ./
COPY src ./src
# drizzle.config.ts imports @/lib/env/server; skip validation so only
# DATABASE_URL (injected by compose) is required.
ENV SKIP_ENV_VALIDATION=1
CMD ["npm", "run", "db:migrate"]

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user (Next's documented standalone convention).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output already contains the minimal traced node_modules + server.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
