import { describe, expect, it } from "vitest";
import {
  getPlatformConfig,
  isPlatform,
  PLATFORM_CONFIG,
  PLATFORM_LIST,
  PLATFORMS,
} from "@/lib/platforms/config";

/**
 * Seam B (pure/validation): the canonical platform config (AGENTS.md §4). Kept
 * in lockstep with the `social_accounts.platform` CHECK vocabulary (PRD §6).
 */
describe("platform config", () => {
  it("lists exactly the 6 launch platforms", () => {
    expect([...PLATFORMS]).toEqual([
      "instagram",
      "facebook",
      "tiktok",
      "linkedin",
      "threads",
      "youtube",
    ]);
  });

  it("every platform has a label and a Zernio slug", () => {
    for (const id of PLATFORMS) {
      const cfg = PLATFORM_CONFIG[id];
      expect(cfg.id).toBe(id);
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.zernioSlug.length).toBeGreaterThan(0);
    }
  });

  it("PLATFORM_LIST is ordered to match PLATFORMS", () => {
    expect(PLATFORM_LIST.map((c) => c.id)).toEqual([...PLATFORMS]);
  });

  it("isPlatform narrows only known platforms", () => {
    expect(isPlatform("instagram")).toBe(true);
    expect(isPlatform("twitter")).toBe(false);
    expect(isPlatform("")).toBe(false);
  });

  it("getPlatformConfig returns config for known, undefined for unknown", () => {
    expect(getPlatformConfig("tiktok")?.label).toBe("TikTok");
    expect(getPlatformConfig("myspace")).toBeUndefined();
  });
});
