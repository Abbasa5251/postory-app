import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvePost,
  createDraft,
  getDraftById,
  listPostsForReview,
  requestChanges,
  submitPost,
  updateDraft,
} from "@/server/dal/posts";
import { ForbiddenError, NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import {
  captureInserts,
  captureUpdate,
  makeBatch,
  makeSelectChain,
  renderedSql,
  renderedWhere,
} from "../helpers/db-mock";
import type { SQL } from "drizzle-orm";

/**
 * A8 mock-level tenancy proof for the posts DAL (C1 + E1 transitions). Every
 * exported query renders an org_id predicate bound to ctx.orgId; every write
 * sets org_id from the ctx (never input); brand access is asserted (creators
 * 404 on unassigned brands); the E1 state transitions audit + enforce the §5
 * self-approval rule. Adding a method here is the tests/authz/README.md checklist.
 */

const { select, insert, update, batch } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/db/db", () => ({
  db: { select, insert, update, batch },
}));

beforeEach(() => {
  // mockReset (not clearAllMocks) so any unconsumed mockReturnValueOnce queue
  // from a test that threw early (e.g. self-approval blocked before its last
  // select) can't bleed into the next test. Each test re-primes its mocks.
  select.mockReset();
  insert.mockReset();
  update.mockReset();
  batch.mockReset();
});

/**
 * A thenable/chainable select result mirroring makeSelectChain, queued so a
 * method that runs several selects (approve: post → brand → org-settings →
 * round) gets a distinct result per call via select.mockReturnValueOnce.
 */
function chainReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (f: (v: unknown[]) => unknown, r?: unknown) =>
      Promise.resolve(rows).then(f, r as never),
  } as unknown as { where: ReturnType<typeof vi.fn> } & Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  for (const key of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "groupBy",
    "orderBy",
  ]) {
    chain[key]!.mockReturnValue(chain);
  }
  chain.limit!.mockResolvedValue(rows);
  return chain;
}

function queueSelects(rowsList: unknown[][]) {
  for (const rows of rowsList) select.mockReturnValueOnce(chainReturning(rows));
}

const POST_ROW = {
  id: "post_1",
  brandId: "brand_1",
  status: "IN_REVIEW",
  currentVersionId: "v1",
  createdBy: "member_2",
};

// owner/admin/approver-shaped ctx (full brand access).
const adminCtx = memberCtx({ role: "admin", brandIds: "all" });

const CONTENT = {
  targets: ["instagram" as const],
  variants: { instagram: { caption: "hello" } },
};

function type(values: unknown) {
  return values as Record<string, unknown>;
}

describe("getDraftById — org scoping is structurally present", () => {
  it("filters on org_id = ctx.orgId and post id", async () => {
    const chain = makeSelectChain(select, [
      { id: "post_1", brandId: "brand_1", status: "DRAFT", content: null },
    ]);
    await getDraftById(adminCtx, "post_1");
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("post_1");

    // The current-version leftJoin is itself org-scoped (tenancy on the join,
    // not just the outer where) — a cross-org version can't leak in.
    expect(chain.leftJoin).toHaveBeenCalledOnce();
    const joinCond = renderedSql(chain.leftJoin.mock.calls[0]![1] as SQL);
    expect(joinCond.sql).toContain("org_id");
    expect(joinCond.params).toContain("org_1");
  });

  it("404s when no row matches (nonexistent / cross-org)", async () => {
    makeSelectChain(select, []);
    await expect(getDraftById(adminCtx, "post_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("createDraft — writes org_id from ctx and audits", () => {
  it("sets org_id on the post and version inserts and audits post.create", async () => {
    const inserts = captureInserts(insert, [{ id: "post_1" }]);
    captureUpdate(update);
    const result = await createDraft(adminCtx, {
      brandId: "brand_1",
      content: CONTENT,
    });
    expect(result).toEqual({ id: "post_1" });

    const postInsert = inserts.find((c) => "status" in type(c.values));
    expect(type(postInsert!.values).orgId).toBe("org_1");
    // org comes from ctx, not from any input.
    expect(type(postInsert!.values).brandId).toBe("brand_1");

    const versionInsert = inserts.find((c) => "versionNo" in type(c.values));
    expect(type(versionInsert!.values).orgId).toBe("org_1");

    expect(inserts.some((c) => type(c.values).action === "post.create")).toBe(
      true,
    );
  });

  it("404s (before any insert) when attached media isn't this brand's (C4)", async () => {
    // getMediaByIds returns an asset scoped to the org but a DIFFERENT brand —
    // validatedMediaIds must reject it so foreign refs never reach media_ids.
    makeSelectChain(select, [{ id: "media_x", brandId: "brand_2" }]);
    const inserts = captureInserts(insert, [{ id: "post_1" }]);
    await expect(
      createDraft(adminCtx, {
        brandId: "brand_1",
        content: {
          targets: ["instagram" as const],
          variants: { instagram: { caption: "x", mediaIds: ["media_x"] } },
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });
});

describe("updateDraft — appends an immutable version, DRAFT-only", () => {
  it("inserts a new version with org_id from ctx and audits post.update", async () => {
    makeSelectChain(select, [
      {
        id: "post_1",
        brandId: "brand_1",
        status: "DRAFT",
        currentVersionId: "v1",
        content: null,
        versionNo: 2,
      },
    ]);
    const inserts = captureInserts(insert, [{ id: "v3" }]);
    captureUpdate(update);

    const result = await updateDraft(adminCtx, {
      postId: "post_1",
      content: CONTENT,
    });
    expect(result).toEqual({ id: "post_1" });

    const versionInsert = inserts.find((c) => "versionNo" in type(c.values));
    expect(type(versionInsert!.values).orgId).toBe("org_1");
    // Immutability: a NEW version number, never an UPDATE of an existing row.
    expect(type(versionInsert!.values).versionNo).toBe(3);
    expect(inserts.some((c) => type(c.values).action === "post.update")).toBe(
      true,
    );
  });

  it("rejects editing a non-DRAFT post (ForbiddenError) and writes nothing", async () => {
    makeSelectChain(select, [
      { id: "post_1", brandId: "brand_1", status: "APPROVED", content: null },
    ]);
    const inserts = captureInserts(insert);
    captureUpdate(update);
    await expect(
      updateDraft(adminCtx, { postId: "post_1", content: CONTENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // No new version, no pointer update, no audit — the guard runs first.
    expect(inserts).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("404s on a cross-org / nonexistent post before any write", async () => {
    makeSelectChain(select, []);
    const inserts = captureInserts(insert);
    captureUpdate(update);
    await expect(
      updateDraft(adminCtx, { postId: "post_x", content: CONTENT }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("updateDraft — E1 edit-revert of a CHANGES_REQUESTED post (§5)", () => {
  it("reverts status to DRAFT and audits the edit", async () => {
    makeSelectChain(select, [
      {
        id: "post_1",
        brandId: "brand_1",
        status: "CHANGES_REQUESTED",
        currentVersionId: "v1",
        content: null,
        versionNo: 2,
      },
    ]);
    const inserts = captureInserts(insert, [{ id: "v3" }]);
    const upd = captureUpdate(update);

    await updateDraft(adminCtx, { postId: "post_1", content: CONTENT });

    // The version-pointer update also flips status back to DRAFT.
    expect(type(upd.set).status).toBe("DRAFT");
    const auditInsert = inserts.find(
      (c) => type(c.values).action === "post.update",
    );
    expect(type(auditInsert!.values).orgId).toBe("org_1");
  });
});

describe("submitPost — DRAFT → IN_REVIEW, org-scoped + audited", () => {
  it("scopes the read + update to org_id and audits post.submit", async () => {
    const chain = makeSelectChain(select, [{ ...POST_ROW, status: "DRAFT" }]);
    const upd = captureUpdate(update, [{ id: "post_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);

    const result = await submitPost(adminCtx, { postId: "post_1" });
    expect(result).toEqual({ id: "post_1", status: "IN_REVIEW" });

    // The scoped fetch filters on org_id + the post id.
    const read = renderedWhere(chain);
    expect(read.sql).toContain("org_id");
    expect(read.params).toContain("org_1");
    // The status update is org-scoped too (belt AND suspenders, §6.4).
    const wrote = renderedSql(upd.where!);
    expect(wrote.sql).toContain("org_id");
    expect(wrote.params).toContain("org_1");
    expect(type(upd.set).status).toBe("IN_REVIEW");
    // The audit insert (in the same batch) carries org_id + the right action.
    const audit = inserts.find((c) => type(c.values).action === "post.submit");
    expect(type(audit!.values).orgId).toBe("org_1");
  });

  it("rejects submitting a non-DRAFT post (TransitionError) with no write", async () => {
    makeSelectChain(select, [{ ...POST_ROW, status: "IN_REVIEW" }]);
    captureUpdate(update, [{ id: "post_1" }]);
    makeBatch(batch);
    await expect(
      submitPost(adminCtx, { postId: "post_1" }),
    ).rejects.toMatchObject({ code: "TRANSITION" });
    expect(update).not.toHaveBeenCalled();
  });

  it("404s a cross-org / nonexistent post before any write", async () => {
    makeSelectChain(select, []);
    makeBatch(batch);
    await expect(
      submitPost(adminCtx, { postId: "post_x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("approvePost — records the decision, enforces self-approval (§5)", () => {
  // Selects, in order: post → brand → org-settings → next-round.
  function primeApproveSelects(opts: {
    post?: Record<string, unknown>;
    requiresClientApproval?: boolean;
    allowSelfApproval?: boolean;
    round?: number;
  }) {
    queueSelects([
      [{ ...POST_ROW, ...opts.post }],
      [
        {
          id: "brand_1",
          orgId: "org_1",
          requiresClientApproval: opts.requiresClientApproval ?? false,
        },
      ],
      [{ allowSelfApproval: opts.allowSelfApproval ?? false }],
      [{ n: (opts.round ?? 1) - 1 }],
    ]);
  }

  it("approves → APPROVED, writes org_id on the approval + audits post.approve", async () => {
    primeApproveSelects({ requiresClientApproval: false });
    const upd = captureUpdate(update, [{ id: "post_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);

    const result = await approvePost(adminCtx, { postId: "post_1" });
    expect(result).toEqual({ id: "post_1", status: "APPROVED" });

    // The status update is org-scoped and stamps internal_approved_by.
    const wrote = renderedSql(upd.where!);
    expect(wrote.sql).toContain("org_id");
    expect(type(upd.set).status).toBe("APPROVED");
    expect(type(upd.set).internalApprovedBy).toBe("member_1");
    // The approvals insert carries org_id from ctx + binds to the version (§5).
    const approval = inserts.find((c) => "postVersionId" in type(c.values));
    expect(type(approval!.values).orgId).toBe("org_1");
    expect(type(approval!.values).postVersionId).toBe("v1");
    expect(type(approval!.values).stage).toBe("internal");
    expect(type(approval!.values).decidedByMemberId).toBe("member_1");
    expect(inserts.some((c) => type(c.values).action === "post.approve")).toBe(
      true,
    );
  });

  it("routes to CLIENT_REVIEW when the brand requires client approval (D2)", async () => {
    primeApproveSelects({ requiresClientApproval: true });
    captureUpdate(update, [{ id: "post_1" }]);
    captureInserts(insert);
    makeBatch(batch);
    const result = await approvePost(adminCtx, { postId: "post_1" });
    expect(result.status).toBe("CLIENT_REVIEW");
  });

  it("blocks approving your OWN post when self-approval is off (§5)", async () => {
    // createdBy === ctx.memberId, allow_self_approval = false → Forbidden.
    primeApproveSelects({
      post: { createdBy: "member_1" },
      allowSelfApproval: false,
    });
    const upd = captureUpdate(update, [{ id: "post_1" }]);
    makeBatch(batch);
    await expect(
      approvePost(memberCtx({ role: "admin", brandIds: "all" }), {
        postId: "post_1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Rejected before the transition batch — nothing written.
    expect(update).not.toHaveBeenCalled();
    void upd;
  });

  it("allows self-approval when the org enables it", async () => {
    primeApproveSelects({
      post: { createdBy: "member_1" },
      allowSelfApproval: true,
    });
    captureUpdate(update, [{ id: "post_1" }]);
    captureInserts(insert);
    makeBatch(batch);
    const result = await approvePost(adminCtx, { postId: "post_1" });
    expect(result.status).toBe("APPROVED");
  });
});

describe("requestChanges — IN_REVIEW → CHANGES_REQUESTED, org-scoped + audited", () => {
  it("records a changes_requested decision with the note and audits", async () => {
    queueSelects([[{ ...POST_ROW }], [{ n: 0 }]]);
    const upd = captureUpdate(update, [{ id: "post_1" }]);
    const inserts = captureInserts(insert);
    makeBatch(batch);

    const result = await requestChanges(adminCtx, {
      postId: "post_1",
      note: "tighten the hook",
    });
    expect(result.status).toBe("CHANGES_REQUESTED");

    const wrote = renderedSql(upd.where!);
    expect(wrote.sql).toContain("org_id");
    const approval = inserts.find((c) => "postVersionId" in type(c.values));
    expect(type(approval!.values).orgId).toBe("org_1");
    expect(type(approval!.values).decision).toBe("changes_requested");
    expect(type(approval!.values).note).toBe("tighten the hook");
    expect(
      inserts.some((c) => type(c.values).action === "post.request_changes"),
    ).toBe(true);
  });
});

describe("listPostsForReview — cross-brand review queue (E2)", () => {
  it("scopes to org_id and the brand allowlist, not org-wide", async () => {
    const chain = makeSelectChain(select, []);
    await listPostsForReview(adminCtx, { brandIds: ["brand_1"] });
    const { sql, params } = renderedWhere(chain);
    expect(sql).toContain("org_id");
    expect(params).toContain("org_1");
    expect(params).toContain("brand_1");
    // An admin assigned only to brand_1 must NOT silently see another brand.
    expect(params).not.toContain("brand_2");
  });

  it("an empty allowlist yields no rows, still org-scoped", async () => {
    const chain = makeSelectChain(select, []);
    const result = await listPostsForReview(adminCtx, { brandIds: [] });
    expect(result).toEqual([]);
    // inArray(brand_id, []) renders SQL false (scope.ts contract); org scope holds.
    expect(renderedWhere(chain).sql).toContain("org_id");
  });

  it("a selected workspace narrows within the allowlist", async () => {
    const chain = makeSelectChain(select, []);
    await listPostsForReview(adminCtx, {
      brandIds: ["brand_1", "brand_2"],
      brandId: "brand_2",
    });
    const { params } = renderedWhere(chain);
    expect(params).toContain("brand_2");
    expect(params).not.toContain("brand_1");
  });

  it("the brand join is org-scoped (no cross-org workspace-name leak)", async () => {
    const chain = makeSelectChain(select, []);
    await listPostsForReview(adminCtx, { brandIds: ["brand_1"] });
    const joinCond = renderedSql(chain.innerJoin.mock.calls[0]![1] as SQL);
    expect(joinCond.sql).toContain("org_id");
    expect(joinCond.params).toContain("org_1");
  });

  it("the platform filter keeps only posts targeting that platform", async () => {
    const reviewRow = (id: string, platform: "instagram" | "facebook") => ({
      id,
      brandId: "brand_1",
      brandName: "Brand One",
      status: "IN_REVIEW",
      content: {
        targets: [platform],
        variants: { [platform]: { caption: "c" } },
      },
      createdAt: new Date(0),
      createdByName: "Someone",
    });
    makeSelectChain(select, [
      reviewRow("p_ig", "instagram"),
      reviewRow("p_fb", "facebook"),
    ]);
    const result = await listPostsForReview(adminCtx, {
      brandIds: ["brand_1"],
      platform: "facebook",
    });
    expect(result.map((r) => r.id)).toEqual(["p_fb"]);
  });
});

describe("posts DAL — brand access is enforced for creators", () => {
  const creatorCtx = memberCtx(); // creator, brandIds ["brand_1"]

  it("createDraft 404s on an unassigned brand (before any insert)", async () => {
    const inserts = captureInserts(insert, [{ id: "post_1" }]);
    await expect(
      createDraft(creatorCtx, { brandId: "brand_2", content: CONTENT }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(inserts).toHaveLength(0);
  });

  it("getDraftById 404s when the post belongs to an unassigned brand", async () => {
    makeSelectChain(select, [
      { id: "post_1", brandId: "brand_2", status: "DRAFT", content: null },
    ]);
    await expect(getDraftById(creatorCtx, "post_1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
