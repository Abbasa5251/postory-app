import "server-only";
import type { AuthCtx } from "@/server/dal/types";
import { ForbiddenError } from "@/server/domain/errors";
import { type Permission, roles } from "@/server/auth/permissions";

// authorize()'s underlying request type (RoleAuthorizeRequest over the app
// statement). All four roles share it — each is ac.newRole() on the same
// access-control instance.
type AuthorizeRequest = Parameters<(typeof roles)["owner"]["authorize"]>[0];

/**
 * The §7 coarse permission gate: the static role-capability check every server
 * action runs before its handler (invoked by `withAction`). Grants → returns;
 * denies → throws `ForbiddenError` (403-shaped, safe to reveal — the entity is
 * visible to the caller, the action is not).
 *
 * Contextual/entity-level rules the §7 matrix names in prose — approver may not
 * approve their OWN post, creator limited to assigned brands — are NOT gated
 * here; they live in `src/server/domain/` + the DAL. This is the coarse gate
 * only.
 *
 * §13.1 human-review hotspot: runtime enforcement of the `permissions.ts` role
 * truth, guarded by the release-blocking authz matrix.
 */
export function authorize(ctx: AuthCtx, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError();
  }
}

/**
 * Non-throwing form of the coarse gate — the SAME check as `authorize`, for
 * server components that decide which controls to render (e.g. showing Approve
 * buttons only to reviewers). UX only: the mutating action always re-runs
 * `authorize` server-side (§7), so this never becomes the security boundary.
 */
export function can(ctx: AuthCtx, permission: Permission): boolean {
  // Background jobs (§6.7) run with full trust and never carry a member role.
  if (ctx.role === "system") return true;

  const [resource, action] = permission.split(":");
  // `permission` is a typed `${resource}:${action}` union, but splitting erases
  // the key↔value correlation, so the dynamically-keyed request can't be
  // inferred as the authorize request. Safe: the Permission type guarantees
  // resource/action name a real statement entry.
  const request = { [resource]: [action] } as AuthorizeRequest;
  return roles[ctx.role].authorize(request).success;
}
