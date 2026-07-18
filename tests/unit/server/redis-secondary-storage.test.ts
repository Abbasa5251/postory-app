import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  redisSecondaryStorage,
  type RedisLike,
} from "@/server/services/redis/secondary-storage";

/**
 * In-memory stand-in for the ioredis client, mirroring documented Redis
 * semantics with ioredis command shapes: SET with the ("EX", ttl) positional
 * form, GETDEL, DEL, and — for the adapter's Lua increment script — the
 * eval(script, numKeys, ...keysThenArgs) form: INCR-creates-at-1 with EXPIRE
 * applied only on creation. Expiry is simulated against Date.now() (driven by
 * vi.useFakeTimers below).
 */
class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: unknown, mode?: "EX", ttl?: number) {
    this.store.set(key, {
      value: String(value),
      expiresAt: mode === "EX" && ttl !== undefined ? Date.now() + ttl * 1000 : null,
    });
    return "OK";
  }

  async del(key: string) {
    const had = this.live(key) ? 1 : 0;
    this.store.delete(key);
    return had;
  }

  async getdel(key: string) {
    const value = this.live(key)?.value ?? null;
    this.store.delete(key);
    return value;
  }

  async eval(_script: string, _numKeys: number, key: string, ttl: string | number) {
    const ttlSeconds = Number(ttl);
    const entry = this.live(key);
    if (!entry) {
      this.store.set(key, {
        value: "1",
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return 1;
    }
    // TTL deliberately untouched: EXPIRE runs only when INCR returned 1.
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }
}

// Test double: structurally compatible with the five methods the adapter
// uses; the full ioredis generic signatures don't matter here.
const asRedisLike = (fake: FakeRedis) => fake as unknown as RedisLike;

describe("redisSecondaryStorage", () => {
  let fake: FakeRedis;
  let storage: ReturnType<typeof redisSecondaryStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = new FakeRedis();
    storage = redisSecondaryStorage(asRedisLike(fake));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("namespaces every key with the ba: prefix", async () => {
    await storage.set("session-token", "payload");
    expect(fake.store.has("ba:session-token")).toBe(true);
    expect(await storage.get("session-token")).toBe("payload");

    await storage.increment("counter", 60);
    expect(fake.store.has("ba:counter")).toBe(true);

    await storage.delete("session-token");
    expect(fake.store.has("ba:session-token")).toBe(false);
  });

  it("round-trips raw strings without JSON handling", async () => {
    const raw = JSON.stringify({ session: { token: "abc" } });
    await storage.set("k", raw);
    // The adapter must hand back the exact string — better-auth parses it.
    expect(await storage.get("k")).toBe(raw);
  });

  it("set with a ttl expires the key; without one it persists", async () => {
    await storage.set("expiring", "v", 30);
    await storage.set("persistent", "v");

    vi.advanceTimersByTime(31_000);
    expect(await storage.get("expiring")).toBeNull();
    expect(await storage.get("persistent")).toBe("v");
  });

  it("getAndDelete returns the value exactly once", async () => {
    await storage.set("once", "v");
    expect(await storage.getAndDelete("once")).toBe("v");
    expect(await storage.get("once")).toBeNull();
    expect(await storage.getAndDelete("once")).toBeNull();
  });

  it("increment creates at 1 with the ttl and counts up", async () => {
    expect(await storage.increment("rl", 60)).toBe(1);
    expect(await storage.increment("rl", 60)).toBe(2);
    expect(await storage.increment("rl", 60)).toBe(3);
  });

  it("increment does NOT extend the ttl on later calls (fixed rate-limit window)", async () => {
    await storage.increment("rl", 60);
    // 50s in: another increment must not push expiry past the original 60s.
    vi.advanceTimersByTime(50_000);
    expect(await storage.increment("rl", 60)).toBe(2);
    // 61s after creation the window is over — counter restarts.
    vi.advanceTimersByTime(11_000);
    expect(await storage.increment("rl", 60)).toBe(1);
  });

  it("get fails open to a miss when the client throws (DB fallback handles it)", async () => {
    vi.spyOn(fake, "get").mockRejectedValueOnce(new Error("redis down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(await storage.get("k")).toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("increment fails CLOSED: client errors propagate to the rate limiter", async () => {
    vi.spyOn(fake, "eval").mockRejectedValueOnce(new Error("redis down"));
    await expect(storage.increment("rl", 60)).rejects.toThrow("redis down");
  });

  it("set fails open: a Redis write failure must not break sign-in (DB is authoritative)", async () => {
    vi.spyOn(fake, "set").mockRejectedValue(new Error("redis down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await expect(storage.set("k", "v", 60)).resolves.toBeUndefined();
    await expect(storage.set("k", "v")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("delete fails CLOSED: revocation errors propagate (no silently-alive sessions)", async () => {
    vi.spyOn(fake, "del").mockRejectedValueOnce(new Error("redis down"));
    await expect(storage.delete("k")).rejects.toThrow("redis down");
  });

  it("passes the ttl through to the atomic script call", async () => {
    const evalSpy = vi.spyOn(fake, "eval");
    await storage.increment("rl", 900);
    // ioredis eval: (script, numKeys, ...keysThenArgs).
    expect(evalSpy).toHaveBeenCalledWith(
      expect.stringContaining("INCR"),
      1,
      "ba:rl",
      900,
    );
  });
});
