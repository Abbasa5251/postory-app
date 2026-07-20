import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraft, getDraftById, updateDraft } from "@/server/dal/posts";
import { ForbiddenError, NotFoundError } from "@/server/domain/errors";
import { memberCtx } from "../helpers/ctx";
import {
  captureInserts,
  captureUpdate,
  makeSelectChain,
  renderedWhere,
} from "../helpers/db-mock";

/**
 * A8 mock-level tenancy proof for the posts DAL (C1). Every exported query
 * renders an org_id predicate bound to ctx.orgId; every write sets org_id from
 * the ctx (never input); brand access is asserted (creators 404 on unassigned
 * brands). Adding a method here is the tests/authz/README.md checklist.
 */

const { select, insert, update } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/db/db", () => ({
  db: { select, insert, update },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("rejects editing a non-DRAFT post (ForbiddenError)", async () => {
    makeSelectChain(select, [
      { id: "post_1", brandId: "brand_1", status: "APPROVED", content: null },
    ]);
    captureInserts(insert);
    captureUpdate(update);
    await expect(
      updateDraft(adminCtx, { postId: "post_1", content: CONTENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("404s on a cross-org / nonexistent post before any write", async () => {
    makeSelectChain(select, []);
    await expect(
      updateDraft(adminCtx, { postId: "post_x", content: CONTENT }),
    ).rejects.toBeInstanceOf(NotFoundError);
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
