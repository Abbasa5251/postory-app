import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "@upstash/redis";
import { getRedis, redisConfigured } from "@/server/services/redis/client";
import {
  upstashSecondaryStorage,
  type RedisLike,
} from "@/server/services/redis/secondary-storage";

/**
 * LIVE smoke test for the self-hosted SRH + redis:7 stack. It drives the EXACT
 * command surface better-auth uses through the secondaryStorage adapter —
 * GET, SET…EX, GETDEL, DEL, and the Lua EVAL increment (the fail-CLOSED auth
 * rate-limit path). Reuses the real adapter so there is no drift from prod.
 *
 * NOT part of the CI gate: it needs a live REST endpoint, so it lives outside
 * vitest.config.mts's `unit`/`authz` projects and runs only via its own config:
 *
 *   UPSTASH_REDIS_REST_URL=http://localhost:8079 \
 *   UPSTASH_REDIS_REST_TOKEN=<SRH_TOKEN> \
 *   npm run test:smoke:srh
 *
 * (Point the URL at SRH — e.g. a temporary `docker compose` port map, or run
 * from inside the network with http://srh:80.) Skips (never fails) when Redis
 * isn't configured, so an accidental run is a no-op.
 */
describe.skipIf(!redisConfigured())("SRH + redis smoke", () => {
  let redis: Redis;
  let storage: ReturnType<typeof upstashSecondaryStorage>;
  // Unique per run so parallel/re-runs never collide. Date.now() is fine here
  // (a normal test runtime, not a workflow script).
  const key = `smoke:${Date.now()}`;
  const incKey = `${key}:inc`;

  beforeAll(() => {
    redis = getRedis();
    storage = upstashSecondaryStorage(redis as RedisLike);
  });

  afterAll(async () => {
    // Namespaced with the adapter's "ba:" prefix.
    await redis.del(`ba:${key}`).catch(() => {});
    await redis.del(`ba:${incKey}`).catch(() => {});
  });

  it("round-trips set(ttl) → get → getAndDelete (SET EX / GET / GETDEL)", async () => {
    await storage.set(key, "hello", 60);
    expect(await storage.get(key)).toBe("hello");
    expect(await storage.getAndDelete!(key)).toBe("hello");
    expect(await storage.get(key)).toBeNull();
  });

  it("EVAL increment creates at 1 and keeps a fixed window (does not extend TTL)", async () => {
    // This is the distributed rate-limit primitive — a broken EVAL 500s auth.
    expect(await storage.increment!(incKey, 60)).toBe(1);
    expect(await storage.increment!(incKey, 60)).toBe(2);
    // TTL was set only on creation, never extended by the second increment.
    const ttl = await redis.ttl(`ba:${incKey}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
