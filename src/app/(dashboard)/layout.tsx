import { ensureSession } from "@better-auth-ui/react/server";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/features/shell/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getQueryClient } from "@/lib/query-client";
import { recoverActiveOrg } from "@/server/auth/active-org";
import { auth } from "@/server/auth/auth";
import { getAuthCtx } from "@/server/auth/context";
import { listBrands } from "@/server/dal/brands";

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

  // Shell data (§5 thin layout): the gate above guarantees getAuthCtx resolves.
  // Brands feed the sidebar's brand switcher + nav (org-scoped, creator-narrowed).
  const ctx = await getAuthCtx();
  const [brands, organization, cookieStore] = await Promise.all([
    listBrands(ctx),
    auth.api.getFullOrganization({ headers: requestHeaders }),
    cookies(),
  ]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          orgName={organization?.name ?? "POSTORY"}
        />
        <SidebarInset>
          {/* Mobile-only top bar: the desktop sidebar is always visible (mockup
              has no top bar); the trigger opens the sheet drawer on mobile. */}
          <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
            <span className="font-heading text-base font-semibold">
              Postory
            </span>
          </header>
          <div className="mx-auto w-full max-w-6xl px-6 py-8 md:px-10">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </HydrationBoundary>
  );
}
