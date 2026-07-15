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
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { db } from "@/db/db";
// AGENTS.md §6 exception: the better-auth adapter needs the drizzle client and
// schema directly. This file (and the future DAL) are the only allowed homes
// for a `@/db/db` import.
import * as authSchema from "@/db/schemas/auth";
import { env } from "@/lib/env/server";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  appName: "POSTORY",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // schema must be passed explicitly: drizzle v1 instances created via
  // drizzle(url, { relations }) expose no `_.fullSchema` for the adapter to
  // discover tables from.
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // ADR-011: email verification required
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const { sendResetPasswordEmail } = await import(
        "@/server/services/email/auth-emails"
      );
      await sendResetPasswordEmail({ to: user.email, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendVerificationEmail } = await import(
        "@/server/services/email/auth-emails"
      );
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
          // also set it (plugin behavior); this covers plain sign-ins.
          // better-auth tables are queried via better-auth's own adapter, not
          // drizzle (AGENTS.md §6: better-auth-owned tables).
          if (!ctx) return;
          const members = await ctx.context.adapter.findMany<{
            organizationId: string;
          }>({
            model: "member",
            where: [{ field: "userId", value: session.userId }],
            sortBy: { field: "createdAt", direction: "asc" },
            limit: 1,
          });
          const organizationId = members[0]?.organizationId;
          if (!organizationId) return;
          return { data: { ...session, activeOrganizationId: organizationId } };
        },
      },
    },
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
        const { sendOrgInvitationEmail } = await import(
          "@/server/services/email/auth-emails"
        );
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
    }),
    // Required for server actions/components to set cookies; must be the
    // LAST plugin (better-auth requirement).
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
