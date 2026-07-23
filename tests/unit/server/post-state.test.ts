import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/domain/errors";
import {
  assertCanApprove,
  canTransition,
  POST_STATUSES,
  type PostAction,
  type PostStatus,
  transition,
  TransitionError,
} from "@/server/domain/post-state";

/**
 * E1 post-state machine (§5) — pure, no DB / no I/O (the DB writes live in
 * dal/posts.ts, proven separately in tests/authz/posts-dal.test.ts). Exhaustive
 * transition coverage per AGENTS.md §11: every legal edge, the approve fork on
 * the brand's client-approval toggle, and that every other (status, action)
 * pair is rejected with a TransitionError.
 */

describe("transition — internal-stage edges (§5)", () => {
  it("DRAFT → submit → IN_REVIEW", () => {
    expect(transition("DRAFT", "submit")).toBe("IN_REVIEW");
  });

  it("IN_REVIEW → request_changes → CHANGES_REQUESTED", () => {
    expect(transition("IN_REVIEW", "request_changes")).toBe(
      "CHANGES_REQUESTED",
    );
  });

  it("CHANGES_REQUESTED → edit → DRAFT (address feedback)", () => {
    expect(transition("CHANGES_REQUESTED", "edit")).toBe("DRAFT");
  });

  it("DRAFT → edit → DRAFT (a plain draft save stays DRAFT)", () => {
    expect(transition("DRAFT", "edit")).toBe("DRAFT");
  });

  it("edits after review/approval revert to DRAFT (§5)", () => {
    // Any content edit after internal approval reverts to DRAFT.
    expect(transition("IN_REVIEW", "edit")).toBe("DRAFT");
    expect(transition("APPROVED", "edit")).toBe("DRAFT");
    expect(transition("CLIENT_REVIEW", "edit")).toBe("DRAFT");
  });
});

describe("transition — the approve fork on requiresClientApproval (§5/D2)", () => {
  it("IN_REVIEW → approve → APPROVED when the brand toggle is off", () => {
    expect(
      transition("IN_REVIEW", "approve", { requiresClientApproval: false }),
    ).toBe("APPROVED");
  });

  it("IN_REVIEW → approve → CLIENT_REVIEW when the brand toggle is on", () => {
    expect(
      transition("IN_REVIEW", "approve", { requiresClientApproval: true }),
    ).toBe("CLIENT_REVIEW");
  });

  it("defaults to the no-client-approval branch when opts is omitted", () => {
    expect(transition("IN_REVIEW", "approve")).toBe("APPROVED");
  });

  it("approve is only legal from IN_REVIEW", () => {
    for (const status of POST_STATUSES) {
      if (status === "IN_REVIEW") continue;
      expect(() => transition(status, "approve")).toThrow(TransitionError);
    }
  });
});

describe("transition — client-stage edges (defined now, driven by E4)", () => {
  it("CLIENT_REVIEW → client_approve → APPROVED", () => {
    expect(transition("CLIENT_REVIEW", "client_approve")).toBe("APPROVED");
  });

  it("CLIENT_REVIEW → client_request_changes → CHANGES_REQUESTED", () => {
    expect(transition("CLIENT_REVIEW", "client_request_changes")).toBe(
      "CHANGES_REQUESTED",
    );
  });

  it("client-stage actions are illegal outside CLIENT_REVIEW", () => {
    for (const status of POST_STATUSES) {
      if (status === "CLIENT_REVIEW") continue;
      expect(() => transition(status, "client_approve")).toThrow(
        TransitionError,
      );
      expect(() => transition(status, "client_request_changes")).toThrow(
        TransitionError,
      );
    }
  });
});

describe("transition — archive (§5: any live state → ARCHIVED)", () => {
  it("archives from every state except ARCHIVED", () => {
    for (const status of POST_STATUSES) {
      if (status === "ARCHIVED") {
        expect(() => transition(status, "archive")).toThrow(TransitionError);
      } else {
        expect(transition(status, "archive")).toBe("ARCHIVED");
      }
    }
  });
});

describe("transition — illegal edges are rejected", () => {
  it("cannot submit anything but a DRAFT", () => {
    for (const status of POST_STATUSES) {
      if (status === "DRAFT") continue;
      expect(() => transition(status, "submit")).toThrow(TransitionError);
    }
  });

  it("cannot request_changes outside IN_REVIEW (internal stage)", () => {
    for (const status of POST_STATUSES) {
      if (status === "IN_REVIEW") continue;
      expect(() => transition(status, "request_changes")).toThrow(
        TransitionError,
      );
    }
  });

  it("cannot edit terminal / publishing states (Epic F unschedules first)", () => {
    for (const status of [
      "SCHEDULED",
      "PUBLISHING",
      "PUBLISHED",
      "FAILED",
      "ARCHIVED",
    ] satisfies PostStatus[]) {
      expect(() => transition(status, "edit")).toThrow(TransitionError);
    }
  });

  it("the thrown error carries the TRANSITION code (ADR-013)", () => {
    try {
      transition("PUBLISHED", "submit");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError);
      expect((error as TransitionError).code).toBe("TRANSITION");
    }
  });
});

describe("canTransition — the non-throwing UI predicate", () => {
  it("mirrors transition without throwing", () => {
    expect(canTransition("DRAFT", "submit")).toBe(true);
    expect(canTransition("PUBLISHED", "submit")).toBe(false);
    expect(
      canTransition("IN_REVIEW", "approve", { requiresClientApproval: true }),
    ).toBe(true);
  });

  it("covers every (status, action) pair without throwing", () => {
    const actions: PostAction[] = [
      "submit",
      "approve",
      "request_changes",
      "edit",
      "archive",
      "client_approve",
      "client_request_changes",
    ];
    for (const status of POST_STATUSES) {
      for (const action of actions) {
        expect(typeof canTransition(status, action)).toBe("boolean");
      }
    }
  });
});

describe("assertCanApprove — self-approval rule (§5, org setting default off)", () => {
  it("allows approving another member's post regardless of the setting", () => {
    expect(() =>
      assertCanApprove({ isOwnPost: false, allowSelfApproval: false }),
    ).not.toThrow();
    expect(() =>
      assertCanApprove({ isOwnPost: false, allowSelfApproval: true }),
    ).not.toThrow();
  });

  it("blocks approving your own post when self-approval is off", () => {
    expect(() =>
      assertCanApprove({ isOwnPost: true, allowSelfApproval: false }),
    ).toThrow(ForbiddenError);
  });

  it("allows approving your own post when the org enables self-approval", () => {
    expect(() =>
      assertCanApprove({ isOwnPost: true, allowSelfApproval: true }),
    ).not.toThrow();
  });
});
