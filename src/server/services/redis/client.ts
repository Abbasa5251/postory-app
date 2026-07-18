// NOTE: no `import 'server-only'` here — this module sits in the static
// import graph of `src/server/auth/auth.ts` (better-auth needs the
// secondaryStorage at construction), which the better-auth CLI loads for
// schema generation and which rejects 'server-only'. Nothing here runs I/O
// at module load: the client is constructed lazily on first use.
import { Redis } from "ioredis";
import { env } from "@/lib/env/server";
import { shouldEnforceProductionEnv } from "@/lib/env/runtime";

export function redisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

// ADR-011: production must have Redis — auth rate limiting and session
// secondaryStorage silently degrading would be a hardening regression. Same
// fail-fast pattern as the EMAIL_FROM guard in services/email. Fires on
// Vercel builds and at production server boot (via src/instrumentation.ts),
// but not on local/CI `next build`, which runs without deploy secrets.
if (shouldEnforceProductionEnv() && !redisConfigured()) {
  throw new Error(
    "REDIS_URL must be set in production (ADR-011 auth hardening: rate limits + session secondary storage).",
  );
}

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    if (!redisConfigured()) {
      throw new Error("Redis is not configured (REDIS_URL missing).");
    }
    // Standard Redis wire protocol (ioredis) — no vendor SDK, no HTTP proxy.
    // Connects lazily (lazyConnect) so importing this module never opens a
    // socket; the first command triggers the connection.
    client = new Redis(env.REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }
  return client;
}
