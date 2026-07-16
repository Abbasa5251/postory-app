import { describe, expect, it } from "vitest";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { roles } from "@/server/auth/permissions";

/**
 * A8 — the exhaustive §7 role×permission matrix (release-blocking, ADR-002
 * tenant-isolation boundary). Every cell of the AGENTS.md §7 authorization
 * table is asserted here against the SPEC, so widening or narrowing a grant in
 * permissions.ts fails loudly in both directions.
 *
 * Scope of THIS file: the coarse role→permission statements (`authorize()`).
 * Finer domain rules the matrix names in prose — approver may not approve
 * their OWN post, creator limited to assigned brands — are NOT access-control
 * statements; they live in src/server/domain/ + the DAL and are covered by
 * dal-scoping.test.ts (and their feature PRs). See tests/authz/README.md.
 *
 * Deferred (tracked as it.todo below, not silently dropped):
 *   - portal-token column (§7) — PortalCtx / dal/portal.ts land in Epic E.
 */

// authorize()'s request type (RoleAuthorizeRequest over the app statement).
// All four roles share it — each is ac.newRole() on the same access-control.
type AuthorizeRequest = Parameters<(typeof roles)["owner"]["authorize"]>[0];

/** Does `role` hold every one of `actions` on `resource`? */
function grants(role: Role, resource: string, actions: string[]): boolean {
  // A data-driven request loses literal-key typing; the resource/action come
  // from the matrix tables below, so the cast to the authorize request is safe.
  const request = { [resource]: actions } as AuthorizeRequest;
  return roles[role].authorize(request).success;
}

const ROLES = Object.keys(ROLE_LABELS) as Role[];

// ── §7 app-resource matrix ────────────────────────────────────────────────
// Every (resource, action) the app declares. Drives full coverage below.
type AppResource = "brand" | "account" | "post" | "ai" | "analytics";
const APP_ACTIONS: Record<AppResource, readonly string[]> = {
  brand: ["create", "update", "delete", "read"],
  account: ["connect", "disconnect"],
  post: ["create", "approve", "schedule"],
  ai: ["generate"],
  analytics: ["view"],
};

// Allowed grants transcribed BY HAND from the AGENTS.md §7 table (the spec —
// deliberately not derived from permissions.ts, which would be tautological).
// Anything absent here is expected-denied.
const EXPECTED: Record<Role, Partial<Record<AppResource, readonly string[]>>> = {
  owner: {
    brand: ["create", "update", "delete", "read"],
    account: ["connect", "disconnect"],
    post: ["create", "approve", "schedule"],
    ai: ["generate"],
    analytics: ["view"],
  },
  admin: {
    brand: ["create", "update", "delete", "read"],
    account: ["connect", "disconnect"],
    post: ["create", "approve", "schedule"],
    ai: ["generate"],
    analytics: ["view"],
  },
  approver: {
    brand: ["read"], // reads brands; cannot create/update/delete them
    account: ["connect", "disconnect"],
    post: ["create", "approve", "schedule"],
    ai: ["generate"],
    analytics: ["view"],
  },
  creator: {
    post: ["create"], // drafts only — no approve/schedule
    ai: ["generate"],
    analytics: ["view"],
    // no brand:read, no account:* — brand scoping via brand_members (B5)
  },
};

describe("§7 role × app-permission matrix (every cell)", () => {
  for (const role of ROLES) {
    for (const resource of Object.keys(APP_ACTIONS) as AppResource[]) {
      for (const action of APP_ACTIONS[resource]) {
        const allowed = EXPECTED[role][resource]?.includes(action) ?? false;
        it(`${role} ${allowed ? "MAY" : "may NOT"} ${resource}:${action}`, () => {
          expect(grants(role, resource, [action])).toBe(allowed);
        });
      }
    }
  }
});

// ── §7 org administration (billing / members / settings) ───────────────────
describe("§7 org administration — owner/admin only", () => {
  // approver + creator were created with ZERO org statements: they can touch
  // none of the plugin's org/member/invitation/team/ac actions.
  for (const role of ["approver", "creator"] as const) {
    for (const [resource, actions] of Object.entries(defaultStatements)) {
      for (const action of actions) {
        it(`${role} may NOT ${resource}:${action}`, () => {
          expect(grants(role, resource, [action])).toBe(false);
        });
      }
    }
  }

  // owner + admin can administer the org. Representative subset both hold
  // (admin lacks organization:delete — that's owner-only, not asserted here).
  const ADMIN_GRANTS: Record<string, string[]> = {
    organization: ["update"],
    member: ["create"],
    invitation: ["create"],
  };
  for (const role of ["owner", "admin"] as const) {
    for (const [resource, actions] of Object.entries(ADMIN_GRANTS)) {
      it(`${role} MAY ${resource}:${actions.join(",")}`, () => {
        expect(grants(role, resource, actions)).toBe(true);
      });
    }
  }
});

// ── §7 portal-token column — deferred to Epic E ────────────────────────────
// Portal tokens never produce an AuthCtx (they get PortalCtx in dal/portal.ts).
// These land with Epic E; kept as pending so the gap is visible in the runner.
describe("portal-token capabilities (Epic E)", () => {
  it.todo(
    "portal 'approve' token authorizes client-stage approve on scoped posts only",
  );
  it.todo(
    "portal 'report' token authorizes analytics:view on scoped brand+month only",
  );
  it.todo("portal token cannot perform any internal-role action");
});
