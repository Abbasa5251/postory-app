import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/features/shell/page-header";
import { type Role, ROLE_LABELS } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { getAuthCtx } from "@/server/auth/context";
import { listOrgMembers } from "@/server/dal/org";

// Role → badge palette (postory-design status/accent tokens).
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-accent text-accent-foreground",
  admin: "bg-accent text-accent-foreground",
  approver: "bg-status-scheduled text-status-scheduled-foreground",
  creator: "bg-status-draft text-status-draft-foreground",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Thin route (§5): gate + read + render. Member-centric Brand access surface.
// Managing access is owner/admin only — the same `brand:assign` gate the
// assign/unassign actions enforce (§7); this only hides a surface those roles
// couldn't act on anyway.
export default async function MembersPage() {
  const ctx = await getAuthCtx();
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();

  // Org-scoped by ctx (§6); ≤10 seats (D1) so the whole team is one read.
  const members = await listOrgMembers(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who can draft, approve, and publish across your agency's brands. Open a member to manage their brand access."
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        {members.map((member, i) => (
          <Link
            key={member.id}
            href={`/organization/members/${member.id}/access`}
            className={cn(
              "flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40",
              i > 0 && "border-t",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {initials(member.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {member.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {member.email}
              </span>
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                ROLE_BADGE[member.role] ?? "bg-muted text-muted-foreground",
              )}
            >
              {ROLE_LABELS[member.role as Role] ?? member.role}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
