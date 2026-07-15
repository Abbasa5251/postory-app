// NOTE: no `import 'server-only'` — same CLI constraint as ./client.ts (this
// module is in auth.ts's static import graph).
import type { Redis } from "@upstash/redis";
import type { BetterAuthOptions } from "better-auth/types";
import { getRedis } from "./client";

// Derived structurally: better-auth 1.7.0-rc.1 does not re-export the
// SecondaryStorage interface from a public subpath (it lives in
// @better-auth/core/db, a transitive dep we deliberately don't import from).
type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

// Minimal client surface, injectable for unit tests.
export type RedisLike = Pick<Redis, "get" | "set" | "del" | "getdel" | "eval">;

// Uniform namespace for everything better-auth stores through this adapter
// (sessions, active-session lists, rate-limit counters).
const PREFIX = "ba:";

// SecondaryStorage.increment contract: create at 1 with the given TTL; later
// increments must NOT extend it (the counter expires a fixed window after
// creation — this is what makes secondary-storage-backed rate limiting
// distributed-safe). INCR returns 1 exactly when the key was created, so
// EXPIRE runs only then; a single Lua eval keeps it one atomic round trip.
const INCREMENT_SCRIPT = `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

export function upstashSecondaryStorage(
  redis: RedisLike = getRedis(),
): SecondaryStorage {
  return {
    // Fail open to a miss: sessions also live in Postgres
    // (session.storeSessionInDatabase), and better-auth falls back to the DB
    // on a secondary-storage miss — so a Redis outage degrades session reads
    // instead of turning every authenticated request into a 500.
    get: async (key) => {
      try {
        return await redis.get<string>(PREFIX + key);
      } catch (error) {
        console.error("[redis] get failed; treating as miss", error);
        return null;
      }
    },
    getAndDelete: async (key) => redis.getdel<string>(PREFIX + key),
    // Errors propagate: rate limiting must fail CLOSED (better a 500 on the
    // auth endpoint during a Redis outage than an unmetered brute-force
    // window).
    increment: async (key, ttl) =>
      redis.eval<[number], number>(INCREMENT_SCRIPT, [PREFIX + key], [ttl]),
    // Fail open like `get`: set is session write-back — Postgres is the
    // source of truth (session.storeSessionInDatabase) and reads fall back
    // to the DB, so a failed Redis write must not turn sign-in into a 500.
    set: async (key, value, ttl) => {
      try {
        if (ttl !== undefined) {
          await redis.set(PREFIX + key, value, { ex: ttl });
        } else {
          await redis.set(PREFIX + key, value);
        }
      } catch (error) {
        console.error("[redis] set failed; relying on DB fallback", error);
      }
    },
    // Errors propagate: delete is session revocation — failing open would
    // leave a revoked session alive in Redis until it expires.
    delete: async (key) => {
      await redis.del(PREFIX + key);
    },
  };
}
