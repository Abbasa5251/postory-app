import * as z from "zod";

/**
 * Comment input schemas (E3). Canonical zod home per AGENTS.md §4 — compose,
 * never redeclare. Validated at the server-action boundary (§7/§9). @-mentions
 * are NOT a field here: they are encoded inline in `body` and derived
 * server-side (see `@/lib/mentions`), so the body is the single source of truth
 * and a hostile client cannot claim a mention the text doesn't contain.
 */

/** Create a comment on a post. `postId` is re-scoped server-side (§7). */
export const createCommentSchema = z.object({
  postId: z.uuid("Post id is required."),
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    // Generous ceiling — a comment carries prose plus inline mention markers
    // (`@[Name](id)`), which are longer than the visible `@Name`.
    .max(4000, "Comment is too long."),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** Toggle a comment's resolved flag. */
export const resolveCommentSchema = z.object({
  commentId: z.uuid("Comment id is required."),
  resolved: z.boolean(),
});
export type ResolveCommentInput = z.infer<typeof resolveCommentSchema>;
