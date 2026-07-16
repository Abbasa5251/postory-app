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
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // Escape hatch for tooling that loads this module without a full env
  // (better-auth CLI schema generation, CI builds). Requires the exact value
  // "1" so SKIP_ENV_VALIDATION=false/0 stays disabled. Never set in dev/prod.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
