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
