import "server-only";
import type { Role } from "@/lib/auth/roles";

/**
 * AGENTS.md §6: the tenancy context every DAL function takes as its FIRST
 * argument — org scoping isn't optional because the ctx isn't. Constructed
 * ONLY in src/server/auth/context.ts (getAuthCtx / getSystemCtx); nothing
 * else builds one by hand, and orgId never comes from client input.
 *
 * AuthCtx is a union discriminated by `role` (a deliberate refinement of the
 * AGENTS.md §6 snippet, flagged in the A5 PR notes): 'system' stays out of
 * the user-facing Role type (permissions.ts, UI role lists), and code that
 * must never run as a background job can require MemberCtx at the type level.
 *
 * Portal tokens never produce an AuthCtx: they get the narrower PortalCtx
 * (token id, capability, scoped post/brand ids) with dedicated DAL methods in
 * src/server/dal/portal.ts when Epic E lands (AGENTS.md §6.5). Do not widen
 * this union for portals.
 */
export type MemberCtx = {
  /** From session.activeOrganizationId — never from client input. */
  orgId: string;
  memberId: string;
  role: Role;
  /**
   * Resolved brand access: creators get their brand_members rows (B5);
   * owner/admin/approver always "all".
   */
  brandIds: string[] | "all";
};

/**
 * Background jobs (AGENTS.md §6.7): explicit org, full brand access,
 * audited as actor_type 'system'.
 */
export type SystemCtx = {
  orgId: string;
  role: "system";
  brandIds: "all";
  /** Inngest function name, e.g. 'generation/image.requested' — becomes audit_log.actor_id. */
  jobName: string;
};

export type AuthCtx = MemberCtx | SystemCtx;
