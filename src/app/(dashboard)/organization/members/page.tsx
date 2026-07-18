import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { auth } from "@/server/auth/auth";
import { getAuthCtx } from "@/server/auth/context";

// Thin route (§5): gate + read + render. Navigation into the member-centric
// Brand access surface. Managing member access is owner/admin only — the same
// `brand:assign` gate the assign/unassign actions enforce (§7); this only hides
// a surface those roles couldn't act on anyway.
export default async function MembersPage() {
  const ctx = await getAuthCtx();
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();

  // listMembers defaults to the active org and self-verifies membership; ≤10
  // seats (D1) so the default page is the whole team.
  const { members } = await auth.api.listMembers({ headers: await headers() });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          Manage which brands each member can access.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((member) => (
          <li key={member.id}>
            <Link
              href={`/organization/members/${member.id}/access`}
              className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="transition-colors hover:border-ring">
                <CardHeader>
                  <CardTitle>{member.user.name}</CardTitle>
                  <CardDescription>
                    {member.user.email} ·{" "}
                    {ROLE_LABELS[member.role as Role] ?? member.role}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
