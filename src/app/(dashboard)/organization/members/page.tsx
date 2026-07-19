import { notFound } from "next/navigation";
import { TeamRoster } from "@/components/features/team/team-roster";
import { getAuthCtx } from "@/server/auth/context";

// Thin route (§5): server gate + render. The roster manages members client-side
// via the better-auth org APIs. Managing the team is owner/admin only — the same
// gate the member mutations enforce (§7); this hides a surface those roles
// couldn't act on anyway. Each member row also links to their B5.3 brand access.
export default async function MembersPage() {
  const ctx = await getAuthCtx();
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();

  return <TeamRoster />;
}
