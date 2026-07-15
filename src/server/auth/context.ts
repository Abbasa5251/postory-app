import "server-only";
import { headers } from "next/headers";
import type { Role } from "@/lib/auth/roles";
import { auth } from "./auth";

/**
 * AGENTS.md §6: the authenticated tenancy context every DAL method takes as
 * its first argument. Constructed here and nowhere else. orgId comes from the
 * better-auth session — client-supplied org/brand ids are never trusted.
 */
export type AuthCtx = {
  orgId: string;
  memberId: string;
  role: Role;
  brandIds: string[] | "all";
};

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated or no active organization") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getAuthCtx(): Promise<AuthCtx> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.session.activeOrganizationId) {
    throw new UnauthorizedError();
  }
  const member = await auth.api.getActiveMember({ headers: h });
  if (!member) {
    throw new UnauthorizedError("Not a member of the active organization");
  }
  return {
    orgId: session.session.activeOrganizationId,
    memberId: member.id,
    role: member.role as Role,
    // B5: resolve creator brand access from brand_members once that table
    // exists; until then every role sees all brands.
    brandIds: "all",
  };
}
