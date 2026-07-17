import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureException } from "@sentry/nextjs";
import { captureError } from "@/server/services/observability/capture";
import { log } from "@/server/services/observability/log";
import { memberCtx, systemCtx } from "../../helpers/ctx";

// Sentry is entirely mocked — these are unit tests of our helper, not the SDK.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("log — structured JSON to stdout", () => {
  function captured(fn: () => void): Record<string, unknown> {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      fn();
      return JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
    } finally {
      spy.mockRestore();
    }
  }

  it("emits level, message, an ISO timestamp, and merged fields", () => {
    const rec = captured(() => log.info("brand created", { org: "org_1" }));
    expect(rec).toMatchObject({
      level: "info",
      message: "brand created",
      org: "org_1",
    });
    expect(rec.time).toEqual(expect.any(String));
    expect(new Date(rec.time as string).toISOString()).toBe(rec.time);
  });

  it("carries the level for each method", () => {
    expect(captured(() => log.debug("d")).level).toBe("debug");
    expect(captured(() => log.warn("w")).level).toBe("warn");
    expect(captured(() => log.error("e")).level).toBe("error");
  });

  it("works with no fields", () => {
    const rec = captured(() => log.info("no fields"));
    expect(rec).toMatchObject({ level: "info", message: "no fields" });
  });
});

describe("captureError — Sentry with tenant tags, no PII", () => {
  /** Run the scope callback captureException was called with against a fake scope. */
  function tagsFor(call: number) {
    const scope = { setTags: vi.fn((_tags: Record<string, string>) => scope) };
    // The mocked fn's call args aren't typed; cast the calls array to the shape
    // captureError uses: (error, scopeCallback).
    const calls = vi.mocked(captureException).mock.calls as unknown as Array<
      [unknown, ((s: typeof scope) => typeof scope)?]
    >;
    calls[call]?.[1]?.(scope);
    return scope.setTags.mock.calls[0]?.[0];
  }

  it("forwards the error and tags org/member/role from a member ctx", () => {
    const err = new Error("boom");
    captureError(err, {
      ctx: memberCtx({ orgId: "org_9", memberId: "m_9", role: "admin" }),
    });
    expect(captureException).toHaveBeenCalledWith(err, expect.any(Function));
    expect(tagsFor(0)).toEqual({ org: "org_9", role: "admin", member: "m_9" });
  });

  it("tags a system ctx with the job name as the member/actor", () => {
    captureError(new Error("job failed"), {
      ctx: systemCtx({ orgId: "org_2", jobName: "generation/image" }),
    });
    expect(tagsFor(0)).toEqual({
      org: "org_2",
      role: "system",
      member: "generation/image",
    });
  });

  it("still captures when no ctx is supplied (sets no tags)", () => {
    const err = new Error("no ctx");
    captureError(err);
    expect(captureException).toHaveBeenCalledWith(err, expect.any(Function));
    expect(tagsFor(0)).toBeUndefined();
  });
});
