import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";

export default async function DashboardPage() {
  const h = await headers();
  const [session, member] = await Promise.all([
    auth.api.getSession({ headers: h }),
    auth.api.getActiveMember({ headers: h }),
  ]);
  const organization = await auth.api.getFullOrganization({ headers: h });

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-2xl font-semibold">
        {organization?.name ?? "Dashboard"}
      </h1>
      <p className="text-muted-foreground">
        Signed in as {session?.user.name} ({member?.role}).
      </p>
    </div>
  );
}
