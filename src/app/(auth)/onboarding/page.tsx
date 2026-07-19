import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingCard } from "@/components/features/onboarding/onboarding-card";
import { recoverActiveOrg } from "@/server/auth/active-org";
import { auth } from "@/server/auth/auth";

// Org is required — no personal mode (PRD A3). Onboarding is ONLY for users who
// belong to no organization: a member who merely lost their active org is
// recovered and sent to the dashboard, not asked to create another org.
export default async function OnboardingPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/auth/sign-in");
  if (session.session.activeOrganizationId) redirect("/dashboard");
  if (
    (await recoverActiveOrg(requestHeaders, session.user.id)) === "recovered"
  ) {
    redirect("/dashboard");
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <OnboardingCard />
      <p className="text-center text-xs text-muted-foreground">
        Signed in as {session.user.email}
      </p>
    </div>
  );
}
