"use client";

import {
  type OrganizationAuthClient,
  useAuth,
  useAuthPlugin,
  useCancelInvitation,
  useListOrganizationInvitations,
  useListOrganizationMembers,
  useSession,
  useUpdateMemberRole,
} from "@better-auth-ui/react";
import type { Member, User } from "better-auth/client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { InviteMemberDialog } from "@/components/auth/organization/invite-member-dialog";
import { RemoveMemberDialog } from "@/components/auth/organization/remove-member-dialog";
import { PageHeader } from "@/components/features/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { organizationPlugin } from "@/lib/auth/organization-plugin";
import { brandAccent } from "@/lib/brand-accent";
import { cn } from "@/lib/utils";

type MemberWithUser = Member & { user: Partial<User> };

// Role → badge palette (postory-design status/accent tokens).
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-accent text-accent-foreground",
  admin: "bg-accent text-accent-foreground",
  approver: "bg-status-scheduled text-status-scheduled-foreground",
  creator: "bg-status-draft text-status-draft-foreground",
};

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Avatar({ seed, label }: { seed: string; label: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: brandAccent(seed) }}
    >
      {initials(label)}
    </span>
  );
}

/**
 * Team roster (postory-design "Team"): real member management on top of the
 * better-auth org APIs (list / invite / update-role / remove) + pending
 * invitations, styled to the mockup. Each member row also links to that
 * member's brand access (the page's B5.3 purpose). Owner/admin gate is enforced
 * server-side on the page; better-auth enforces every mutation.
 */
export function TeamRoster() {
  const { authClient } = useAuth();
  const { roles } = useAuthPlugin(organizationPlugin);
  const { data: session } = useSession(authClient);
  const { data: membersData, isPending } = useListOrganizationMembers(
    authClient as OrganizationAuthClient,
  );
  const { data: invitations } = useListOrganizationInvitations(
    authClient as OrganizationAuthClient,
  );

  const { mutate: updateMemberRole, isPending: isUpdatingRole } =
    useUpdateMemberRole(authClient as OrganizationAuthClient, {
      onSuccess: () => toast.success("Role updated"),
    });
  const { mutate: cancelInvitation } = useCancelInvitation(
    authClient as OrganizationAuthClient,
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberWithUser | null>(null);

  const members = membersData?.members ?? [];
  const pendingInvites = (invitations ?? []).filter(
    (invite) => invite.status === "pending",
  );
  // Roles assignable via the dropdown — never "owner" (transfer is separate).
  const assignableRoles = Object.entries(roles).filter(
    ([key]) => key !== "owner",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who can draft, approve, and publish across your agency's brands. Open a member to manage their brand access."
        actions={
          <Button onClick={() => setInviteOpen(true)}>Invite teammate</Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        {isPending ? (
          <div className="flex flex-col gap-3 p-4">
            {["a", "b", "c"].map((key) => (
              <div key={key} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {members.map((member, i) => {
              const name = member.user.name || member.user.email || "Member";
              const canManage =
                member.role !== "owner" && member.userId !== session?.user.id;
              return (
                <div
                  key={member.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    i > 0 && "border-t",
                  )}
                >
                  <Link
                    href={`/organization/members/${member.id}/access`}
                    className="flex min-w-0 flex-1 items-center gap-3 outline-none hover:underline focus-visible:underline"
                  >
                    <Avatar seed={member.userId ?? member.id} label={name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {name}
                      </span>
                      {member.user.email && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {member.user.email}
                        </span>
                      )}
                    </span>
                  </Link>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      ROLE_BADGE[member.role] ??
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {roles?.[member.role] ?? member.role}
                  </span>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={isUpdatingRole}
                          render={
                            <Button variant="outline" size="sm">
                              Change role
                              <ChevronDown />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {assignableRoles.map(([role, label]) => (
                            <DropdownMenuItem
                              key={role}
                              disabled={member.role === role}
                              onClick={() =>
                                updateMemberRole({
                                  memberId: member.id,
                                  role,
                                })
                              }
                            >
                              {label as string}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setRemoveTarget(member)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 border-t px-4 py-3"
              >
                <Avatar seed={invite.id} label={invite.email} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {invite.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Invited as {roles?.[invite.role] ?? invite.role}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-status-pending px-2.5 py-0.5 text-xs font-semibold text-status-pending-foreground">
                  Invite pending
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => cancelInvitation({ invitationId: invite.id })}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </>
        )}
      </div>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {removeTarget && (
        <RemoveMemberDialog
          open={!!removeTarget}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          member={removeTarget}
        />
      )}
    </div>
  );
}
