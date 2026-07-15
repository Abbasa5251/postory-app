import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingCard } from "@/components/features/onboarding/onboarding-card";
import { auth } from "@/server/auth/auth";

// Org is required — no personal mode (PRD A3). Signed-in users without an
// active organization land here; everyone else is bounced to the right place.
export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in");
  if (session.session.activeOrganizationId) redirect("/dashboard");

  return <OnboardingCard userName={session.user.name} />;
}
