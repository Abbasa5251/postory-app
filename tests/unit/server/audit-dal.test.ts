import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { auditLog } from "@/db/schemas/audit";
import {
  buildAuditInsert,
  recordAuditEvent,
  recordAuthEvent,
} from "@/server/dal/audit";
import type { MemberCtx, SystemCtx } from "@/server/dal/types";

// The db client is mocked, not imported: the real @/db/db constructs a pg Pool
// at module load, and the AGENTS.md §6 boundary rule forbids importing it
// outside the DAL — vi.hoisted keeps a handle on the mock without an import.
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

const memberCtx: MemberCtx = {
  orgId: "org_1",
  memberId: "member_1",
  role: "admin",
  brandIds: "all",
};

const systemCtx: SystemCtx = {
  orgId: "org_1",
  role: "system",
  brandIds: "all",
  jobName: "generation/image.requested",
};

describe("recordAuditEvent / buildAuditInsert", () => {
  it("maps a member ctx to ('member', memberId) with orgId from the ctx", async () => {
    await recordAuditEvent(memberCtx, {
      action: "brand.create",
      entityType: "brand",
      entityId: "brand_1",
    });

    expect(insert).toHaveBeenCalledExactlyOnceWith(auditLog);
    expect(values).toHaveBeenCalledExactlyOnceWith({
      orgId: "org_1",
      actorType: "member",
      actorId: "member_1",
      action: "brand.create",
      entityType: "brand",
      entityId: "brand_1",
      ipAddress: null,
      userAgent: null,
      metadata: null,
    });
  });

  it("maps a system ctx to ('system', jobName)", async () => {
    await recordAuditEvent(systemCtx, {
      action: "post.publish_result",
      entityType: "post",
      entityId: "post_1",
    });

    expect(values.mock.calls[0]![0]).toMatchObject({
      orgId: "org_1",
      actorType: "system",
      actorId: "generation/image.requested",
    });
  });

  it("tenancy and actor cannot be spoofed via the event — they only come from ctx", async () => {
    await recordAuditEvent(memberCtx, {
      action: "brand.update",
      entityType: "brand",
      entityId: "brand_1",
      // orgId/actor fields don't exist on OrgAuditEvent; anything smuggled
      // in is stripped by the schema.
      ...({ orgId: "org_evil", actorId: "someone_else" } as object),
    });

    expect(values.mock.calls[0]![0]).toMatchObject({
      orgId: "org_1",
      actorId: "member_1",
    });
  });

  it("THROWS on an invalid action (fail-closed — the deliberate opposite of recordAuthEvent)", async () => {
    await expect(
      recordAuditEvent(memberCtx, {
        action: "NotDotNamespaced",
        entityType: "brand",
        entityId: "b1",
      }),
    ).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it("propagates a failed insert instead of swallowing it", async () => {
    values.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordAuditEvent(memberCtx, {
        action: "brand.delete",
        entityType: "brand",
        entityId: "b1",
      }),
    ).rejects.toThrow("db down");
  });

  it("buildAuditInsert builds the insert on the module db by default", () => {
    buildAuditInsert(memberCtx, {
      action: "post.approve",
      entityType: "post",
      entityId: "post_1",
    });
    expect(insert).toHaveBeenCalledExactlyOnceWith(auditLog);
    expect(values).toHaveBeenCalledOnce();
  });

  it("buildAuditInsert routes the insert through a provided tx executor (interactive-transaction composition)", () => {
    const txValues = vi.fn();
    const txInsert = vi.fn().mockReturnValue({ values: txValues });
    // The Case-A template passes the tx handle so the audit row joins the same
    // transaction as the mutation — the insert must NOT touch the module db.
    buildAuditInsert(
      memberCtx,
      { action: "post.approve", entityType: "post", entityId: "post_1" },
      { insert: txInsert } as never,
    );
    expect(txInsert).toHaveBeenCalledExactlyOnceWith(auditLog);
    expect(txValues).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
  });
});
