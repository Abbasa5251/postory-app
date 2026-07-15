// NOTE: no `import 'server-only'` here — this module is loaded by the
// better-auth CLI (`npx auth generate`) for schema generation, which rejects
// configs whose import graph contains 'server-only'. This file is pure data
// (no I/O, no secrets) and is never imported from client code.
import { APIError } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import type { Role } from "@/lib/auth/roles";

/**
 * Single source of role truth (AGENTS.md §4/§7). Every permission the app
 * checks server-side is declared here; roles are wired into the better-auth
 * organization plugin in `src/server/auth/auth.ts`.
 *
 * Resources mirror the §7 authorization matrix. Actions are the coarse
 * capabilities the matrix names; finer rules (approver may not approve own
 * post, creator limited to assigned brands) are domain rules enforced in
 * `src/server/domain/` and the DAL, not access-control statements.
 */
export const statement = {
  // organization/member/invitation/team statements used by the plugin's own
  // endpoints (invite, remove member, update org, ...).
  ...defaultStatements,
  // §7 "brand: create/edit/delete" (owner/admin) + read for approver visibility
  brand: ["create", "update", "delete", "read"],
  // §7 "account: connect/disconnect" (owner/admin/approver)
  account: ["connect", "disconnect"],
  // §7 post rows — create ⊃ edit/submit · approve ⊃ request-changes (internal) · schedule ⊃ unschedule/retry
  post: ["create", "approve", "schedule"],
  // §7 "AI: generate (spends credits)"
  ai: ["generate"],
  // §7 "analytics: view"
  analytics: ["view"],
} as const;

export const ac = createAccessControl(statement);

// owner / admin: identical app-level grants (§7 matrix rows match); they
// differ only in the plugin's built-in org statements (ownerAc can delete the
// org / transfer ownership).
const fullAppAccess = {
  brand: ["create", "update", "delete", "read"],
  account: ["connect", "disconnect"],
  post: ["create", "approve", "schedule"],
  ai: ["generate"],
  analytics: ["view"],
} as const;

export const owner = ac.newRole({
  ...ownerAc.statements,
  ...fullAppAccess,
});

export const admin = ac.newRole({
  ...adminAc.statements,
  ...fullAppAccess,
});

// approver: all brands in the org; reviews/approves/schedules; may manage
// social account connections; no org/brand/member administration.
export const approver = ac.newRole({
  brand: ["read"],
  account: ["connect", "disconnect"],
  post: ["create", "approve", "schedule"],
  ai: ["generate"],
  analytics: ["view"],
});

// creator: drafts + AI generation + analytics, scoped to assigned brands
// (brand scoping via brand_members lands in B5 — enforced in the DAL).
export const creator = ac.newRole({
  post: ["create"],
  ai: ["generate"],
  analytics: ["view"],
});

export const roles = {
  owner,
  admin,
  approver,
  creator,
} satisfies Record<Role, unknown>;

/**
 * ADR-011/A4: reject any role string outside `roles`. better-auth's built-in
 * "member" passes the org plugin's own validation (it's in the default role
 * set) but maps to ZERO permissions here — an invite carrying it would create
 * a member who can do nothing. Wired into the organizationHooks in auth.ts
 * (invite create/accept, add member, update role). Handles the plugin's
 * comma-joined multi-role strings ("member,approver"). Empty input is a
 * no-op: presence validation is the plugin's job.
 */
export function assertAssignableRole(
  role: string | string[] | undefined | null,
): void {
  const parts = (Array.isArray(role) ? role : (role ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!Object.hasOwn(roles, part)) {
      throw new APIError("BAD_REQUEST", {
        message: `Role '${part}' is not assignable in this application.`,
      });
    }
  }
}

export type { Role };
