"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { assignMember, unassignMember } from "@/server/actions/brand-members";

/**
 * Brand Access section (B5.1) — owner/admin staff a Brand with its members.
 * A per-member Assign/Unassign toggle (an agency has ≤10 seats, so a flat
 * roster beats a picker). Only a `creator` is actually gated by an assignment;
 * for owner/admin/approver the row is stored but inert (they see every Brand
 * via their role), which the UI marks so it never reads as broken. Enforcement
 * is server-side (the `brand:assign` gate); these controls are UX only (§7).
 */
export type AccessMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

export function BrandAccessSection({
  brandId,
  members,
  assignedMemberIds,
}: {
  brandId: string;
  members: AccessMember[];
  assignedMemberIds: string[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const assigned = new Set(assignedMemberIds);

  async function toggle(member: AccessMember, isAssigned: boolean) {
    setPendingId(member.id);
    try {
      const action = isAssigned ? unassignMember : assignMember;
      const result = await action({ brandId, memberId: member.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        isAssigned
          ? `${member.name} removed from this brand`
          : `${member.name} assigned to this brand`,
      );
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No members to assign yet. Invite members from the organization settings.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => {
        const isAssigned = assigned.has(member.id);
        // Only creators are gated by assignments; other roles see all brands.
        const inert = member.role !== "creator";
        return (
          <li
            key={member.id}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{member.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {member.email}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">{roleLabel(member.role)}</Badge>
              {inert && (
                <span className="text-xs text-muted-foreground">
                  sees all brands
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant={isAssigned ? "ghost" : "outline"}
                disabled={pendingId === member.id}
                onClick={() => toggle(member, isAssigned)}
              >
                {isAssigned ? "Unassign" : "Assign"}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
