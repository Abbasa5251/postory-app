import { ensureSession } from "@better-auth-ui/react/server";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher";
import { UserButton } from "@/components/auth/user/user-button";
import { getQueryClient } from "@/lib/query-client";
import { recoverActiveOrg } from "@/server/auth/active-org";
import { auth } from "@/server/auth/auth";

// THE server-side gate (AGENTS.md §7 — client-side guards are UX sugar):
// no session → sign-in; no active org → recover it from the user's memberships
// (org-required app), and only send genuinely org-less users to onboarding.
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const queryClient = getQueryClient();
  const requestHeaders = await headers();
  // getSession resolves null for anonymous visitors; ensureSession rejects
  // only on real failures (DB/auth backend), which must surface, not redirect.
  const session = await ensureSession(queryClient, auth, {
    headers: requestHeaders,
  });

  if (!session) redirect("/auth/sign-in");
  if (!session.session.activeOrganizationId) {
    // A member whose active org is null (cleared, or a pre-org session) — heal
    // it rather than treating it as onboarding. Redirect after recovery so the
    // re-run reads the now-persisted active org; only org-less users onboard.
    const recovery = await recoverActiveOrg(requestHeaders, session.user.id);
    redirect(recovery === "recovered" ? "/dashboard" : "/onboarding");
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex min-h-svh flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-2">
          <div className="flex items-center gap-4">
            <span className="font-heading text-lg font-semibold">POSTORY</span>
            {/* Org-required app (D1/A3): hide the "personal account" entry so a
                member can't clear their active org into a null (no-org) state. */}
            <OrganizationSwitcher hidePersonal />
          </div>
          <UserButton size="icon" />
        </header>
        <main className="flex flex-1 flex-col p-6">{children}</main>
      </div>
    </HydrationBoundary>
  );
}
