/**
 * Role names + display labels (client-safe — src/lib must not import from
 * src/server). The permission statements each role grants live in
 * `src/server/auth/permissions.ts`, which derives its Role type from here.
 *
 * better-auth's built-in "member" role is intentionally absent: it is never
 * offered in the UI and grants no permissions (see permissions.ts).
 */
export const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  approver: "Approver",
  creator: "Creator",
} as const;

export type Role = keyof typeof ROLE_LABELS;

/**
 * Trust-boundary guard for a raw role string (e.g. better-auth's `member.role`).
 * Only the four app roles are valid; better-auth's default "member" and any
 * other value (including comma-joined multi-role strings) fail. getAuthCtx uses
 * this to fail closed rather than cast an unrecognized role into the security
 * context. Pure + client-safe (no server imports).
 */
export function isValidRole(role: string): role is Role {
  return Object.hasOwn(ROLE_LABELS, role);
}
