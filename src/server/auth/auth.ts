// NOTE: no `import 'server-only'` here — this module is loaded by the
// better-auth CLI (`npm run auth:schema`) for schema generation, which rejects
// configs whose import graph contains 'server-only'. The email service (which
// does import 'server-only') is reached via dynamic import() inside callbacks
// so it stays out of the CLI's static module graph.
import { betterAuth } from "better-auth";
// relations-v2 adapter entry: built for drizzle-orm v1's defineRelations API
// (our db instance). better-auth's own `better-auth/adapters/drizzle` re-export
// still points at the legacy fullSchema-based entry.
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { organization } from "better-auth/plugins/organization";
import { db } from "@/db/db";
// AGENTS.md §6 exception: the better-auth adapter needs the drizzle client and
// schema directly. This file (and the future DAL) are the only allowed homes
// for a `@/db/db` import.
import * as authSchema from "@/db/schemas/auth";
import { env } from "@/lib/env/server";
import { redisConfigured } from "@/server/services/redis/client";
import { upstashSecondaryStorage } from "@/server/services/redis/secondary-storage";
import {
  authRequestEvent,
  sessionCreatedEvent,
  userCreatedEvent,
} from "./auth-audit";
import { ac, assertAssignableRole, roles } from "./permissions";
import { selectInitialOrganizationId } from "./select-initial-org";

export const auth = betterAuth({
  appName: "Postory",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // schema must be passed explicitly: drizzle v1 instances created via
  // drizzle(url, { relations }) expose no `_.fullSchema` for the adapter to
  // discover tables from.
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  // ADR-011: Redis-backed session lookups + rate-limit counters. Optional in
  // dev (absent → sessions stay DB-only, as before); the redis client module
  // fails the boot in production when unconfigured.
  ...(redisConfigured() ? { secondaryStorage: upstashSecondaryStorage() } : {}),
  session: {
    // Keep Postgres the source of truth even with secondaryStorage: reads hit
    // Redis and fall back to the DB on a miss, so a Redis flush/outage never
    // mass-logs-out existing sessions, and session rows (ip/user-agent
    // history) remain queryable.
    storeSessionInDatabase: true,
  },
  verification: {
    // Without this, configuring secondaryStorage silently moves verification
    // tokens (email verify, password reset) to Redis AND drops the
    // `verification` table from the CLI-generated schema. Keep them in
    // Postgres: no schema churn, and reset/verify flows survive a Redis
    // outage.
    storeInDatabase: true,
  },
  // ADR-011: rate-limited auth endpoints. Enabled in production only
  // (better-auth default — deliberate: dev/e2e flows stay unthrottled).
  // Counters live in Redis via secondaryStorage.increment (one atomic op per
  // request, distributed-safe); memory fallback only applies when Redis is
  // unconfigured, which production forbids.
  rateLimit: {
    storage: redisConfigured() ? "secondary-storage" : "memory",
    // Overrides of better-auth's built-in specials (3/10s on /sign-in*,
    // /sign-up*; 3/60s on reset/verification sends), tuned per AGENTS.md §7:
    // longer windows to actually blunt brute force, caps sized so an agency
    // office behind one NAT IP isn't locked out. Paths are relative to the
    // /api/auth base. Portal-token endpoints don't exist yet (Epic E) and
    // will state their own rate-limit decision.
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 900, max: 5 },
      "/forget-password": { window: 900, max: 5 },
      "/send-verification-email": { window: 900, max: 5 },
      "/reset-password": { window: 60, max: 5 },
      "/reset-password/*": { window: 60, max: 5 },
      "/organization/invite-member": { window: 60, max: 10 },
    },
  },
  advanced: {
    // ADR-011 cookie review: better-auth defaults are correct (httpOnly,
    // Secure + __Secure- prefix on https baseURL, SameSite=Lax — Strict would
    // break OAuth callbacks and email links); only the prefix is ours.
    cookiePrefix: "postory",
    // Rate-limit keys and session/audit IPs resolve from these headers.
    // Vercel sets both from the connecting client; without this better-auth
    // trusts only a single-value x-forwarded-for and can degrade to ONE
    // shared rate-limit bucket for all users. Dev falls back to 127.0.0.1.
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip"],
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // ADR-011: email verification required
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const { sendResetPasswordEmail } =
        await import("@/server/services/email/auth-emails");
      await sendResetPasswordEmail({ to: user.email, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendVerificationEmail } =
        await import("@/server/services/email/auth-emails");
      await sendVerificationEmail({ to: user.email, url });
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      // Disabled (skipped at init) until credentials are provisioned;
      // email+password is unaffected.
      enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          // Set the active org on every fresh sign-in so users never land in
          // a session without tenancy. Org creation and invitation acceptance
          // also set it (plugin behavior); this covers plain sign-ins. The
          // earliest-membership policy is shared with gate recovery
          // (select-initial-org.ts) so both paths pick the same tenant.
          if (!ctx) return;
          const organizationId = await selectInitialOrganizationId(
            ctx.context.adapter,
            session.userId,
          );
          if (!organizationId) return;
          return { data: { ...session, activeOrganizationId: organizationId } };
        },
        // ADR-011 login audit: any flow that mints a session (email+password,
        // OAuth) is a sign-in success. Awaited — a fire-and-forget promise
        // may be killed post-response on serverless. The DAL is reached via
        // dynamic import (it's server-only; CLI constraint, see header note).
        after: async (session) => {
          const { recordAuthEvent } = await import("@/server/dal/audit");
          await recordAuthEvent(sessionCreatedEvent(session));
        },
      },
    },
    user: {
      create: {
        // ADR-011 login audit: sign-up (email or OAuth user creation).
        after: async (user, ctx) => {
          const { recordAuthEvent } = await import("@/server/dal/audit");
          await recordAuthEvent(
            userCreatedEvent(user, ctx?.headers, ctx?.context.options ?? {}),
          );
        },
      },
    },
  },
  hooks: {
    // ADR-011 login audit: failed sign-ins + password-reset request/complete.
    // better-auth has no failed-login hook; its dispatcher still runs
    // `hooks.after` when an endpoint throws an APIError (exposed on
    // ctx.context.returned). Rate-limited requests are rejected before
    // endpoints run and never reach this hook.
    after: createAuthMiddleware(async (ctx) => {
      const event = authRequestEvent({
        path: ctx.path,
        returned: ctx.context.returned,
        body: ctx.body,
        headers: ctx.headers,
        options: ctx.context.options,
      });
      if (!event) return;
      const { recordAuthEvent } = await import("@/server/dal/audit");
      await recordAuthEvent(event);
    }),
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      requireEmailVerificationOnInvitation: true,
      cancelPendingInvitationsOnReInvite: true,
      invitationExpiresIn: 60 * 60 * 48, // 48h (plugin default, made explicit)
      sendInvitationEmail: async (data) => {
        const { sendOrgInvitationEmail } =
          await import("@/server/services/email/auth-emails");
        await sendOrgInvitationEmail({
          to: data.email,
          // Pending invitations are listed (accept/reject) on the settings
          // organizations page and during onboarding.
          url: `${env.BETTER_AUTH_URL}/settings/organizations`,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          inviterEmail: data.inviter.user.email,
          role: data.role,
        });
      },
      // ADR-011/A4 carry-over: better-auth's built-in "member" role passes
      // the plugin's own validation but maps to zero permissions in
      // permissions.ts — reject it (and any other non-assignable role) on
      // every path that sets a role. beforeAddMember does NOT fire on
      // invitation accept, hence beforeAcceptInvitation as well (it also
      // blocks accepting any legacy pre-guard invites).
      organizationHooks: {
        // C2 (H1 seam): grant the one-time trial credits so a brand-new org has
        // a balance to run AI generation against. Idempotent + fail-soft — a
        // credit-grant failure must not break org creation (H1 owns the real
        // trial lifecycle: expiry, caps, reactivation). Dynamic import keeps the
        // DAL (db/env) out of the better-auth CLI's schema-gen load graph, like
        // recordAuthEvent above.
        afterCreateOrganization: async ({ organization }) => {
          try {
            const { getSystemCtx } = await import("@/server/auth/context");
            const { grantTrialCredits } = await import("@/server/dal/credits");
            await grantTrialCredits(
              getSystemCtx(organization.id, "credits/trial.grant"),
            );
          } catch (error) {
            console.error("[credits] trial grant failed", error);
            // Structured, tagged signal so ops can detect + backfill orgs that
            // started with no trial credits. Fail-soft: never break org create.
            try {
              const { log } =
                await import("@/server/services/observability/log");
              log.error("trial credit grant failed", {
                orgId: organization.id,
                error: error instanceof Error ? error.message : String(error),
              });
            } catch {
              // observability itself is best-effort here.
            }
          }
        },
        beforeCreateInvitation: async ({ invitation }) => {
          assertAssignableRole(invitation.role);
        },
        beforeAcceptInvitation: async ({ invitation }) => {
          assertAssignableRole(invitation.role);
        },
        beforeAddMember: async ({ member }) => {
          assertAssignableRole(member.role);
        },
        beforeUpdateMemberRole: async ({ newRole }) => {
          assertAssignableRole(newRole);
        },
      },
    }),
    // ADR-011 password policy (founder decision, 2026-07-15): keep the
    // default min length 8 (matches better-auth-ui's client-side default);
    // quality comes from rejecting breached passwords. k-anonymity range
    // query to api.pwnedpasswords.com on sign-up/change-password/
    // reset-password only (never sign-in). FAILS CLOSED on HIBP outage —
    // accepted; removing this line is the kill switch.
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password appeared in a known data breach — please choose a different one.",
    }),
    // Required for server actions/components to set cookies; must be the
    // LAST plugin (better-auth requirement).
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
