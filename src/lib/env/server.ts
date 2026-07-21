import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
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
    // Upstash Redis (ADR-011: auth rate limits + better-auth secondaryStorage).
    // Optional in dev and local/CI builds (no secondaryStorage; rate limiting
    // is production-only by better-auth default); the redis service throws in
    // production (Vercel build or server boot) when unset.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
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
    // OpenRouter (C2+, ADR-012) — ALL AI inference (text now, images D2). One
    // workspace key. Optional in the schema so local/CI builds and unit suites
    // don't need it; the OpenRouter service throws at first use when unset (same
    // lazy pattern as getRedis / ZERNIO_API_KEY). Required in production for AI
    // generation to work.
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    // Inngest (C2+, ADR-003) — durable jobs for AI generation/publishing.
    // Both optional in the schema so local/CI builds and the unit suites don't
    // need them; the Inngest SDK also reads them from process.env directly. In
    // local dev set INNGEST_DEV=1 (a platform flag read by the SDK, not modeled
    // here) and no keys are needed. Required in production (Cloud mode): without
    // a signing key the /api/inngest serve endpoint returns 500.
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    // Object storage for media (C4, ADR-007) — S3-compatible: MinIO in dev,
    // Cloudflare R2 in prod. One code path, two backends; only the endpoint +
    // public base URL differ. All optional so local/CI builds and mocked unit
    // suites don't need them; the storage service throws at first use when
    // unset (same lazy pattern as getRedis / ZERNIO_API_KEY). Required in
    // production for uploads. `R2_ENDPOINT` wins; else derived from
    // `R2_ACCOUNT_ID`. `R2_REGION` defaults to "auto" (R2's value; MinIO is
    // configured to match).
    R2_ENDPOINT: z.url().optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_BASE_URL: z.url().optional(),
    R2_REGION: z.string().min(1).optional(),
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // Escape hatch for tooling that loads this module without a full env
  // (better-auth CLI schema generation, CI builds). Requires the exact value
  // "1" so SKIP_ENV_VALIDATION=false/0 stays disabled. Never set in dev/prod.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
