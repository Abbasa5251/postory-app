import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import {
  createComment,
  listCommentsForPosts,
  resolveComment,
} from "@/server/dal/comments";
import { NotFoundError } from "@/server/domain/errors";
import { mentionMarker } from "@/lib/mentions";
import { memberCtx } from "../helpers/ctx";
import {
  captureInserts,
  captureUpdate,
  makeBatch,
  renderedSql,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the comments DAL (E3). Every read renders an
 * org_id predicate bound to ctx.orgId; every write sets org_id from the ctx
 * (never input); brand access is asserted through the commented post (creators
 * 404 on unassigned brands); @mentions are validated against the org so a
 * cross-org member can never be mentioned; writes audit.
 */

const { select, insert, update, batch } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/db/db", () => ({ db: { select, insert, update, batch } }));

beforeEach(() => {
  select.mockReset();
  insert.mockReset();
  update.mockReset();
  batch.mockReset();
});

/** A chainable, thenable select result queued via select.mockReturnValueOnce. */
function chainReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (f: (v: unknown[]) => unknown, r?: unknown) =>
      Promise.resolve(rows).then(f, r as never),
  } as unknown as { where: ReturnType<typeof vi.fn> } & Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  for (const key of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) {
    chain[key]!.mockReturnValue(chain);
  }
  chain.limit!.mockResolvedValue(rows);
  return chain;
}

function queueSelects(rowsList: unknown[][]) {
  const chains = rowsList.map((rows) => chainReturning(rows));
  for (const c of chains) select.mockReturnValueOnce(c);
  return chains;
}

function type(values: unknown) {
  return values as Record<string, unknown>;
}

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const adminCtx = memberCtx({ role: "admin", brandIds: "all" });
const creatorCtx = memberCtx({ role: "creator", brandIds: ["brand_1"] });

// getDraftById selects this shape (posts + leftJoin current version content).
const draftRow = (brandId: string) => ({
  id: "post_1",
  brandId,
  status: "IN_REVIEW",
  currentVersionId: "v1",
  content: null,
});

describe("listCommentsForPosts — org scoping", () => {
  it("filters on org_id = ctx.orgId", async () => {
    const [commentsChain] = queueSelects([[], []]);
    await listCommentsForPosts(adminCtx, ["post_1"]);
    const { sql, params } = renderedSql(
      commentsChain.where.mock.calls[0]![0] as SQL,
    );
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
  });

  it("empty input runs no query", async () => {
    const result = await listCommentsForPosts(adminCtx, []);
    expect(result.size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("createComment — writes org_id from ctx, validates mentions, audits", () => {
  it("sets org_id on the comment + mention rows and audits comment.create", async () => {
    const body = `hi ${mentionMarker("Jane", ID_A)}`;
    // getDraftById → post; getMembersByIds → the mentioned member is in-org.
    queueSelects([
      [draftRow("brand_1")],
      [{ memberId: ID_A, name: "Jane", email: "j@x.co" }],
    ]);
    const inserts = captureInserts(insert, [{ id: "comment_1" }]);

    const result = await createComment(adminCtx, { postId: "post_1", body });

    expect(result).toEqual({
      id: "comment_1",
      brandId: "brand_1",
      mentionedMemberIds: [ID_A],
    });

    const commentInsert = inserts.find((c) => "body" in type(c.values));
    expect(type(commentInsert!.values).orgId).toBe("org_1");
    expect(type(commentInsert!.values).postId).toBe("post_1");
    expect(type(commentInsert!.values).authorMemberId).toBe("member_1");

    const mentionInsert = inserts.find(
      (c) => "mentionedMemberId" in type((c.values as unknown[])?.[0] ?? {}),
    );
    const mentionRows = mentionInsert!.values as Record<string, unknown>[];
    expect(mentionRows[0]!.orgId).toBe("org_1");
    expect(mentionRows[0]!.commentId).toBe("comment_1");
    expect(mentionRows[0]!.mentionedMemberId).toBe(ID_A);

    expect(
      inserts.some((c) => type(c.values).action === "comment.create"),
    ).toBe(true);
  });

  it("drops a mention of a member outside the org (never persisted / emailed)", async () => {
    // Body mentions two members; getMembersByIds returns only the in-org one.
    const body = `${mentionMarker("Jane", ID_A)} ${mentionMarker("Ghost", ID_B)}`;
    queueSelects([
      [draftRow("brand_1")],
      [{ memberId: ID_A, name: "Jane", email: "j@x.co" }],
    ]);
    const inserts = captureInserts(insert, [{ id: "comment_1" }]);

    const result = await createComment(adminCtx, { postId: "post_1", body });

    expect(result.mentionedMemberIds).toEqual([ID_A]);
    const mentionInsert = inserts.find(
      (c) => "mentionedMemberId" in type((c.values as unknown[])?.[0] ?? {}),
    );
    const mentionRows = mentionInsert!.values as Record<string, unknown>[];
    expect(mentionRows).toHaveLength(1);
    expect(mentionRows[0]!.mentionedMemberId).toBe(ID_A);
  });

  it("404s (before any write) when a creator comments on an unassigned brand", async () => {
    // getDraftById returns a post on brand_2; the creator is scoped to brand_1.
    queueSelects([[draftRow("brand_2")]]);
    const inserts = captureInserts(insert, [{ id: "comment_1" }]);
    await expect(
      createComment(creatorCtx, { postId: "post_1", body: "hi" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });
});

describe("resolveComment — org-scoped update + audit", () => {
  it("updates within org scope and audits comment.resolve", async () => {
    // select comment → its post; getDraftById → the post (brand access ok).
    queueSelects([[{ postId: "post_1" }], [draftRow("brand_1")]]);
    const updateCall = captureUpdate(update, [{ id: "comment_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);

    const result = await resolveComment(adminCtx, {
      commentId: "comment_1",
      resolved: true,
    });
    expect(result).toEqual({
      id: "comment_1",
      resolved: true,
      brandId: "brand_1",
    });

    const { sql, params } = renderedSql(updateCall.where as SQL);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(
      inserts.some((c) => type(c.values).action === "comment.resolve"),
    ).toBe(true);
  });

  it("audits comment.unresolve when reopening", async () => {
    queueSelects([[{ postId: "post_1" }], [draftRow("brand_1")]]);
    captureUpdate(update, [{ id: "comment_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);

    await resolveComment(adminCtx, { commentId: "comment_1", resolved: false });
    expect(
      inserts.some((c) => type(c.values).action === "comment.unresolve"),
    ).toBe(true);
  });

  it("404s on a cross-org / nonexistent comment before any write", async () => {
    queueSelects([[]]); // comment select finds nothing
    const inserts = captureInserts(insert);
    captureUpdate(update);
    makeBatch(batch);
    await expect(
      resolveComment(adminCtx, { commentId: "comment_x", resolved: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });
});
