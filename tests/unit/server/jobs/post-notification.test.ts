import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postNotificationJob } from "@/server/jobs/notification/post-notification";

/**
 * Job-level test for the E3 post-notification fan-out via `@inngest/test`. Proves
 * recipient routing per kind (submitted → reviewers, approved → author, mention
 * → targets), that the actor is excluded from their own event, and that a failed
 * send is best-effort (logged, not fatal; only successes counted).
 */

const {
  getSystemCtx,
  getBrandById,
  getDraftById,
  getCommentById,
  listBrandMemberIds,
  listOrgReviewers,
  getPostAuthor,
  getMembersByIds,
  sendPostSubmittedEmail,
  sendPostApprovedEmail,
  sendPostChangesRequestedEmail,
  sendMentionEmail,
  logWarn,
} = vi.hoisted(() => ({
  getSystemCtx: vi.fn((orgId: string, jobName: string) => ({
    orgId,
    role: "system",
    brandIds: "all",
    jobName,
  })),
  getBrandById: vi.fn(),
  getDraftById: vi.fn(),
  getCommentById: vi.fn(),
  listBrandMemberIds: vi.fn(),
  listOrgReviewers: vi.fn(),
  getPostAuthor: vi.fn(),
  getMembersByIds: vi.fn(),
  sendPostSubmittedEmail: vi.fn(),
  sendPostApprovedEmail: vi.fn(),
  sendPostChangesRequestedEmail: vi.fn(),
  sendMentionEmail: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/server/auth/context", () => ({ getSystemCtx }));
vi.mock("@/server/dal/brands", () => ({ getBrandById }));
vi.mock("@/server/dal/posts", () => ({ getDraftById }));
vi.mock("@/server/dal/comments", () => ({ getCommentById }));
vi.mock("@/server/dal/brand-members", () => ({ listBrandMemberIds }));
vi.mock("@/server/dal/org", () => ({
  listOrgReviewers,
  getPostAuthor,
  getMembersByIds,
}));
vi.mock("@/server/services/email/notification-emails", () => ({
  sendPostSubmittedEmail,
  sendPostApprovedEmail,
  sendPostChangesRequestedEmail,
  sendMentionEmail,
}));
vi.mock("@/server/services/observability", () => ({
  log: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/env/server", () => ({
  env: { BETTER_AUTH_URL: "https://app.test" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  getBrandById.mockResolvedValue({ name: "Acme" });
  getDraftById.mockResolvedValue({
    content: {
      targets: ["instagram"],
      variants: { instagram: { caption: "Hello" } },
    },
  });
  // Actor-name lookup (ids include the actor) vs. recipient lookup.
  getMembersByIds.mockImplementation((_ctx: unknown, ids: string[]) =>
    ids.includes("m_actor")
      ? Promise.resolve([
          { memberId: "m_actor", name: "Alice", email: "a@x.co" },
        ])
      : Promise.resolve(
          ids.map((id) => ({ memberId: id, name: id, email: `${id}@x.co` })),
        ),
  );
});

function run(data: Record<string, unknown>) {
  const engine = new InngestTestEngine({ function: postNotificationJob });
  return engine.execute({
    events: [{ name: "post/notification.requested", data }],
  });
}

const base = { orgId: "org_1", postId: "post_1", brandId: "brand_1" };

describe("postNotificationJob", () => {
  it("submitted → emails every brand-assigned reviewer except the actor", async () => {
    listOrgReviewers.mockResolvedValue([
      { memberId: "m_actor", name: "Alice", email: "a@x.co" },
      { memberId: "m2", name: "Bob", email: "b@x.co" },
      { memberId: "m3", name: "Cara", email: "c@x.co" },
    ]);
    // All three are assigned to the brand.
    listBrandMemberIds.mockResolvedValue(["m_actor", "m2", "m3"]);

    const { result, error } = await run({
      ...base,
      kind: "submitted",
      actorMemberId: "m_actor",
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ kind: "submitted", sent: 2 });
    expect(sendPostSubmittedEmail).toHaveBeenCalledTimes(2);
    const tos = sendPostSubmittedEmail.mock.calls.map((c) => c[0].to);
    expect(tos).toEqual(["b@x.co", "c@x.co"]);
    // Reviewer link points at the approvals queue.
    expect(sendPostSubmittedEmail.mock.calls[0]![0].url).toContain(
      "/approvals",
    );
  });

  it("submitted → excludes a reviewer not assigned to the brand (E2 scoping)", async () => {
    listOrgReviewers.mockResolvedValue([
      { memberId: "m2", name: "Bob", email: "b@x.co" },
      { memberId: "m3", name: "Cara", email: "c@x.co" },
    ]);
    // Only m2 is assigned to this brand; m3 must not be emailed.
    listBrandMemberIds.mockResolvedValue(["m2"]);

    const { result } = await run({
      ...base,
      kind: "submitted",
      actorMemberId: "m_actor",
    });
    expect(result).toMatchObject({ sent: 1 });
    expect(sendPostSubmittedEmail.mock.calls.map((c) => c[0].to)).toEqual([
      "b@x.co",
    ]);
  });

  it("approved → emails the post author", async () => {
    getPostAuthor.mockResolvedValue({
      memberId: "m_author",
      name: "Dana",
      email: "d@x.co",
    });

    const { result, error } = await run({
      ...base,
      kind: "approved",
      actorMemberId: "m_actor",
      note: "nice",
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ kind: "approved", sent: 1 });
    expect(sendPostApprovedEmail).toHaveBeenCalledOnce();
    expect(sendPostApprovedEmail.mock.calls[0]![0]).toMatchObject({
      to: "d@x.co",
      note: "nice",
    });
  });

  it("approved by the author themselves → nobody emailed (actor excluded)", async () => {
    getPostAuthor.mockResolvedValue({
      memberId: "m_actor",
      name: "Alice",
      email: "a@x.co",
    });

    const { result } = await run({
      ...base,
      kind: "approved",
      actorMemberId: "m_actor",
    });
    expect(result).toMatchObject({ sent: 0 });
    expect(sendPostApprovedEmail).not.toHaveBeenCalled();
  });

  it("mention → emails each mentioned member", async () => {
    getCommentById.mockResolvedValue({
      body: "look @[Bob](m2)",
      authorMemberId: "m_actor",
    });

    const { result, error } = await run({
      ...base,
      kind: "mention",
      actorMemberId: "m_actor",
      commentId: "c1",
      mentionedMemberIds: ["m2", "m3"],
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ kind: "mention", sent: 2 });
    expect(sendMentionEmail).toHaveBeenCalledTimes(2);
    // The excerpt collapses the marker to @Bob.
    expect(sendMentionEmail.mock.calls[0]![0].commentExcerpt).toBe("look @Bob");
  });

  it("is best-effort: one failed send is logged, others still count", async () => {
    listOrgReviewers.mockResolvedValue([
      { memberId: "m2", name: "Bob", email: "b@x.co" },
      { memberId: "m3", name: "Cara", email: "c@x.co" },
    ]);
    listBrandMemberIds.mockResolvedValue(["m2", "m3"]);
    sendPostSubmittedEmail.mockRejectedValueOnce(new Error("bounce"));

    const { result, error } = await run({
      ...base,
      kind: "submitted",
      actorMemberId: "m_actor",
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ recipients: 2, sent: 1 });
    expect(logWarn).toHaveBeenCalled();
  });
});
