import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../../helpers/ctx";

// getAuthCtx is the one boundary we stub (the session); authorize, zod, and the
// error mapping all run for real. A partial mock keeps UnauthorizedError real so
// `instanceof` in the wrapper matches. next/headers, the better-auth instance,
// and the creator-brand resolver (B5.2, which pulls in @/db/db) are stubbed to
// keep context.ts's import graph light (mirrors context.test.ts).
const { getAuthCtx } = vi.hoisted(() => ({ getAuthCtx: vi.fn() }));
const { captureError, log } = vi.hoisted(() => ({
  captureError: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: {} } }));
vi.mock("@/server/dal/brand-members", () => ({
  resolveCreatorBrandIds: vi.fn(),
}));
vi.mock("@/server/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/context")>()),
  getAuthCtx,
}));
vi.mock("@/server/services/observability", () => ({ captureError, log }));

import { withAction } from "@/server/actions/with-action";
import { UnauthorizedError } from "@/server/auth/context";

const schema = z.object({ name: z.string().min(2) });

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an approver with full brand access (passes post:create/approve).
  getAuthCtx.mockResolvedValue(
    memberCtx({ role: "approver", brandIds: "all" }),
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("withAction — the §7 action pipeline + error contract (ADR-013)", () => {
  it("returns VALIDATION with fieldErrors and never authenticates or runs the handler on invalid input", async () => {
    const handler = vi.fn();
    const res = await withAction(schema, "post:create", handler)({ name: "x" });
    expect(res).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: expect.any(String),
        fieldErrors: { name: expect.arrayContaining([expect.any(String)]) },
      },
    });
    expect(getAuthCtx).not.toHaveBeenCalled(); // parse is step 1
    expect(handler).not.toHaveBeenCalled();
  });

  it("parses, authorizes, runs the handler with (data, ctx), and wraps the result", async () => {
    const ctx = memberCtx({ role: "approver", brandIds: "all" });
    getAuthCtx.mockResolvedValue(ctx);
    const handler = vi.fn().mockResolvedValue({ id: "brand_9" });
    const res = await withAction(
      schema,
      "post:create",
      handler,
    )({ name: "Acme" });
    expect(res).toEqual({ ok: true, data: { id: "brand_9" } });
    expect(handler).toHaveBeenCalledWith({ name: "Acme" }, ctx);
  });

  it("maps a thrown DomainError to its code + message, without reporting it", async () => {
    const handler = vi
      .fn()
      .mockRejectedValue(new NotFoundError("Brand", "b_x"));
    const res = await withAction(
      schema,
      "post:create",
      handler,
    )({ name: "Acme" });
    expect(res).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("not found"),
      },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it("denies via the real authorize() gate → FORBIDDEN, handler not run", async () => {
    getAuthCtx.mockResolvedValue(
      memberCtx({ role: "creator", brandIds: ["brand_1"] }),
    );
    const handler = vi.fn();
    // creator cannot approve posts (§7)
    const res = await withAction(
      schema,
      "post:approve",
      handler,
    )({ name: "Acme" });
    expect(res).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("maps an UnauthorizedError from getAuthCtx to UNAUTHORIZED, without reporting it", async () => {
    getAuthCtx.mockRejectedValue(new UnauthorizedError());
    const handler = vi.fn();
    const res = await withAction(
      schema,
      "post:create",
      handler,
    )({ name: "Acme" });
    expect(res).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("reports an unexpected error and returns INTERNAL in production (no re-throw)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const boom = new Error("db exploded");
    const handler = vi.fn().mockRejectedValue(boom);
    const res = await withAction(
      schema,
      "post:create",
      handler,
    )({ name: "Acme" });
    expect(res).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: expect.any(String) },
    });
    // the generic message must not leak the real error
    if (!res.ok) expect(res.error.message).not.toContain("db exploded");
    expect(captureError).toHaveBeenCalledWith(boom, {
      ctx: expect.any(Object),
    });
    expect(log.error).toHaveBeenCalled();
  });

  it("re-throws an unexpected error in development, after reporting it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const boom = new Error("db exploded");
    const handler = vi.fn().mockRejectedValue(boom);
    await expect(
      withAction(schema, "post:create", handler)({ name: "Acme" }),
    ).rejects.toThrow("db exploded");
    expect(captureError).toHaveBeenCalledWith(boom, {
      ctx: expect.any(Object),
    });
  });
});
