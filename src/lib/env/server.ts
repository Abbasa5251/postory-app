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
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // Escape hatch for tooling that loads this module without a full env
  // (better-auth CLI schema generation, CI builds). Never set in dev/prod runtime.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
