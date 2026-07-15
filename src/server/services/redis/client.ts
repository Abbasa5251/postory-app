// NOTE: no `import 'server-only'` here — this module sits in the static
// import graph of `src/server/auth/auth.ts` (better-auth needs the
// secondaryStorage at construction), which the better-auth CLI loads for
// schema generation and which rejects 'server-only'. Nothing here runs I/O
// at module load: the client is constructed lazily on first use.
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env/server";

export function redisConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

// ADR-011: production must have Redis — auth rate limiting and session
// secondaryStorage silently degrading would be a hardening regression. Same
// fail-fast-at-boot pattern as the EMAIL_FROM guard in services/email.
// NODE_ENV read directly: build-time constant, not modeled by t3-env.
if (process.env.NODE_ENV === "production" && !redisConfigured()) {
  throw new Error(
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production (ADR-011 auth hardening: rate limits + session secondary storage).",
  );
}

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    if (!redisConfigured()) {
      throw new Error(
        "Upstash Redis is not configured (UPSTASH_REDIS_REST_URL/TOKEN missing).",
      );
    }
    client = new Redis({
      // Non-null asserted: redisConfigured() above guarantees both values.
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
      // better-auth's SecondaryStorage contract passes and expects raw
      // strings (it JSON-serializes sessions itself); the SDK's automatic
      // JSON deserialization would hand back objects instead.
      automaticDeserialization: false,
    });
  }
  return client;
}
