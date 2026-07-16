import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldEnforceProductionEnv } from "@/lib/env/runtime";

const PHASE_PRODUCTION_BUILD = "phase-production-build";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shouldEnforceProductionEnv", () => {
  it("is off in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldEnforceProductionEnv()).toBe(false);
  });

  it("is off in the test env (vitest default)", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(shouldEnforceProductionEnv()).toBe(false);
  });

  it("is off during a local/CI production build (no VERCEL)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    vi.stubEnv("VERCEL", "");
    expect(shouldEnforceProductionEnv()).toBe(false);
  });

  it("is on during a Vercel production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
    vi.stubEnv("VERCEL", "1");
    expect(shouldEnforceProductionEnv()).toBe(true);
  });

  it.each(["0", "false"])(
    'stays off during a production build when VERCEL=%s (only exactly "1" counts)',
    (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
      vi.stubEnv("VERCEL", value);
      expect(shouldEnforceProductionEnv()).toBe(false);
    },
  );

  it("is on at production runtime (no build phase)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("VERCEL", "");
    expect(shouldEnforceProductionEnv()).toBe(true);
  });

  it("is on at Vercel production runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("VERCEL", "1");
    expect(shouldEnforceProductionEnv()).toBe(true);
  });

  it("ignores VERCEL outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(shouldEnforceProductionEnv()).toBe(false);
  });
});
