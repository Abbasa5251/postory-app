import type { MemberCtx, SystemCtx } from "@/server/dal/types";

/**
 * Shared AuthCtx factories for the test suites (A8). The real ctx is built
 * ONLY in src/server/auth/context.ts (AGENTS.md §6.3); these mirror its shape
 * for DAL/authz tests so each file stops hand-rolling its own. Override only
 * what a case cares about.
 */

/** A member ctx; defaults to a `creator` with full brand access. */
export function memberCtx(overrides: Partial<MemberCtx> = {}): MemberCtx {
  return {
    orgId: "org_1",
    memberId: "member_1",
    role: "creator",
    brandIds: "all",
    ...overrides,
  };
}

/** A background-job (system) ctx; explicit org, full brand access. */
export function systemCtx(overrides: Partial<SystemCtx> = {}): SystemCtx {
  return {
    orgId: "org_1",
    role: "system",
    brandIds: "all",
    jobName: "test/job",
    ...overrides,
  };
}
