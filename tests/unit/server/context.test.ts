import { describe, expect, it, vi } from "vitest";

// context.ts statically imports next/headers and the better-auth instance;
// getSystemCtx touches neither, so both are stubbed to keep the import light.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: {} } }));

import { getSystemCtx } from "@/server/auth/context";

describe("getSystemCtx", () => {
  it("builds a system ctx with full brand access and job attribution", () => {
    const ctx = getSystemCtx("org_1", "generation/image.requested");
    expect(ctx).toEqual({
      orgId: "org_1",
      role: "system",
      brandIds: "all",
      jobName: "generation/image.requested",
    });
  });
});
