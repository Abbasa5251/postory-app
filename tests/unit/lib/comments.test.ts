import { describe, expect, it } from "vitest";
import {
  createCommentSchema,
  resolveCommentSchema,
} from "@/lib/validation/comments";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("createCommentSchema", () => {
  it("accepts a non-empty body on a valid post id", () => {
    const result = createCommentSchema.safeParse({
      postId: UUID,
      body: "Looks good",
    });
    expect(result.success).toBe(true);
  });

  it("trims and rejects an empty body", () => {
    expect(
      createCommentSchema.safeParse({ postId: UUID, body: "   " }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid post id", () => {
    expect(
      createCommentSchema.safeParse({ postId: "nope", body: "hi" }).success,
    ).toBe(false);
  });

  it("rejects an over-long body", () => {
    expect(
      createCommentSchema.safeParse({ postId: UUID, body: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });
});

describe("resolveCommentSchema", () => {
  it("accepts a boolean resolved flag", () => {
    expect(
      resolveCommentSchema.safeParse({ commentId: UUID, resolved: true })
        .success,
    ).toBe(true);
  });

  it("rejects a missing resolved flag", () => {
    expect(resolveCommentSchema.safeParse({ commentId: UUID }).success).toBe(
      false,
    );
  });
});
