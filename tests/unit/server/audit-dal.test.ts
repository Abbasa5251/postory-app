import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { auditLog } from "@/db/schemas/audit";
import { recordAuthEvent } from "@/server/dal/audit";

// The db client is mocked, not imported: the real @/db/db constructs a neon()
// client at module load (no URL under SKIP_ENV_VALIDATION), and the AGENTS.md
// §6 boundary rule forbids importing it outside the DAL — vi.hoisted keeps a
// handle on the mock without an import.
const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/db/db", () => ({ db: { insert } }));

let values: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  values = vi.fn().mockResolvedValue(undefined);
  insert.mockReturnValue({ values });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordAuthEvent", () => {
  it("validates and inserts one audit_log row with the DAL column mapping", async () => {
    await recordAuthEvent({
      action: "auth.sign_in.succeeded",
      userId: "user_1",
      orgId: "org_1",
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
    });

    expect(insert).toHaveBeenCalledExactlyOnceWith(auditLog);
    expect(values).toHaveBeenCalledExactlyOnceWith({
      orgId: "org_1",
      actorType: "user",
      actorId: "user_1",
      action: "auth.sign_in.succeeded",
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
      metadata: null,
    });
  });

  it("applies schema truncation before persisting", async () => {
    await recordAuthEvent({
      action: "auth.sign_in.failed",
      userAgent: "x".repeat(10_000),
    });
    expect(values).toHaveBeenCalledOnce();
    expect(values.mock.calls[0]![0].userAgent).toHaveLength(512);
  });

  it("never throws on an invalid event (logs instead — sign-in must not break)", async () => {
    await expect(
      // Intentionally invalid action; cast to reach the runtime guard.
      recordAuthEvent({ action: "not.a.real.action" as never }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("never throws when the insert itself fails", async () => {
    values.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordAuthEvent({ action: "auth.sign_up", userId: "user_1" }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
