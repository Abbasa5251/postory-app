import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    // Standard Postgres connection string (postgres://…). Any Postgres — a
    // local container or a cloud provider's direct connection endpoint.
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    // Optional until a Google OAuth client is provisioned; the google social
    // provider is registered with `enabled: false` while these are absent.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1),
    // Verified-domain sender, e.g. "POSTORY <no-reply@postory.app>".
    // Optional in dev (falls back to the Resend sandbox sender); the email
    // service refuses the sandbox fallback in production.
    EMAIL_FROM: z.string().min(1).optional(),
    // Redis connection string (redis://… or rediss://…) — ADR-011: auth rate
    // limits + better-auth secondaryStorage. A standard Redis endpoint (local
    // container, or a cloud provider's native TCP endpoint). Optional in dev
    // and local/CI builds (no secondaryStorage; rate limiting is
    // production-only by better-auth default); the redis service throws in
    // production (Vercel build or server boot) when unset.
    REDIS_URL: z.url().optional(),
    // Sentry error reporting (A6). Optional everywhere — Sentry no-ops without
    // it; a production server boot only WARNs when it is missing (never
    // throws), so it can't add a blocker to deploys. The build-time
    // source-map-upload inputs (SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT)
    // are bundler-plugin tooling, not app runtime, so they stay out of this
    // schema and are read directly in next.config.ts.
    SENTRY_DSN: z.url().optional(),
    // Zernio publishing API key (B3+). One workspace key for all of POSTORY.
    // Optional in the schema so local/CI builds and the unit suites (which mock
    // fetch) don't need it; the Zernio service throws at first use when unset
    // (same lazy pattern as getRedis). Required in production for account
    // connection / publishing to work.
    ZERNIO_API_KEY: z.string().min(1).optional(),
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // Escape hatch for tooling that loads this module without a full env
  // (better-auth CLI schema generation, CI builds). Requires the exact value
  // "1" so SKIP_ENV_VALIDATION=false/0 stays disabled. Never set in dev/prod.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
