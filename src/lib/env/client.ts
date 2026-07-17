import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  client: {
    // Sentry browser DSN (A6). Optional — the client SDK no-ops without it.
    // NEXT_PUBLIC by necessity (it ships to the browser); a DSN is not a
    // secret (it only authorizes ingesting events, never reading them).
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
});
