import * as z from "zod";

/**
 * Brand-assignment input schemas (B5). Canonical zod home per AGENTS.md §4 —
 * compose, never redeclare. Validated at the server-action boundary (§7/§9).
 *
 * `brandId` is a brand uuid; `memberId` is a better-auth `member` id (text, not
 * a uuid) — both are opaque ids we only bound-check here. The real guarantees
 * are enforced in the DAL: the brand is org-scoped, and the target member is
 * proven to belong to the caller's org before any row is written.
 */
export const assignMemberSchema = z.object({
  brandId: z.string().min(1, "Brand id is required."),
  memberId: z.string().min(1, "Member id is required."),
});

export type AssignMemberInput = z.infer<typeof assignMemberSchema>;
