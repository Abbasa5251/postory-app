import "server-only";
import { headers } from "next/headers";
import { isValidRole } from "@/lib/auth/roles";
import { resolveCreatorBrandIds } from "@/server/dal/brand-members";
import type { MemberCtx, SystemCtx } from "@/server/dal/types";
import { auth } from "./auth";

// AGENTS.md §6: the ctx types live with the DAL contract (dal/types.ts);
// construction happens here and nowhere else.
export type { AuthCtx, MemberCtx, SystemCtx } from "@/server/dal/types";

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated or no active organization") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * The one place a member tenancy context is built (AGENTS.md §6.3): orgId
 * comes from the better-auth session — client-supplied org/brand ids are
 * never trusted.
 */
export async function getAuthCtx(): Promise<MemberCtx> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.session.activeOrganizationId) {
    throw new UnauthorizedError();
  }
  const member = await auth.api.getActiveMember({ headers: h });
  if (!member) {
    throw new UnauthorizedError("Not a member of the active organization");
  }
  const role = member.role;
  // Fail closed (§7): every member-write path validates the role
  // (assertAssignableRole in the org hooks), so an unrecognized role at this
  // trust boundary is an anomaly — refuse to mint a security context rather than
  // cast it blindly into the creator brand-scoping decision below.
  if (!isValidRole(role)) {
    throw new UnauthorizedError("Member has an unrecognized role");
  }
  return {
    orgId: session.session.activeOrganizationId,
    memberId: member.id,
    role,
    // AGENTS.md §6.5: only a creator is brand-scoped — resolved FRESH per
    // request from brand_members (assigned none → sees nothing). owner/admin/
    // approver see every brand, so they short-circuit to "all" and never hit
    // the resolver (the brand_members row is inert for them, B5.1).
    brandIds:
      role === "creator"
        ? await resolveCreatorBrandIds(
            session.session.activeOrganizationId,
            member.id,
          )
        : "all",
  };
}

/**
 * Background jobs only (AGENTS.md §6.7): full brand access, audited as
 * actor_type 'system' with jobName as the actor id — required so every job
 * self-attributes in audit_log.
 *
 * Pure construction, no existence check: this file cannot touch the db (the
 * §6 ESLint boundary), and jobs are trusted callers. orgId MUST originate
 * from an event our own server code emitted (Inngest payloads are
 * zod-validated at the job edge) — never from client input.
 */
export function getSystemCtx(orgId: string, jobName: string): SystemCtx {
  return { orgId, role: "system", brandIds: "all", jobName };
}
