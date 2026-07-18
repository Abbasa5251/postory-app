"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { assignMember, unassignMember } from "@/server/actions/brand-members";

/**
 * Member Access section (B5.3) — the member-centric mirror of
 * BrandAccessSection: owner/admin toggle ONE member across every Brand, instead
 * of one Brand across every member. Same `brand_members` rows, same
 * assign/unassign actions (gated `brand:assign`, owner/admin only) — this is a
 * second view, never a second write path. Only a `creator` is actually gated by
 * an assignment; for every other role the rows are inert (they see all Brands
 * via their role), which the banner marks so it never reads as broken.
 * Enforcement is server-side; these controls are UX only (§7).
 */
export type AccessBrand = {
  id: string;
  name: string;
};

export function MemberAccessSection({
  memberId,
  memberName,
  memberRole,
  brands,
  assignedBrandIds,
}: {
  memberId: string;
  memberName: string;
  memberRole: string;
  brands: AccessBrand[];
  assignedBrandIds: string[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const assigned = new Set(assignedBrandIds);
  // Only creators are gated by assignments; other roles see all brands, so the
  // rows are stored but inert for them (mirrors BrandAccessSection).
  const inert = memberRole !== "creator";

  async function toggle(brand: AccessBrand, isAssigned: boolean) {
    setPendingId(brand.id);
    try {
      const action = isAssigned ? unassignMember : assignMember;
      const result = await action({ brandId: brand.id, memberId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        isAssigned
          ? `${memberName} removed from ${brand.name}`
          : `${memberName} assigned to ${brand.name}`,
      );
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (brands.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No brands yet. Create a brand before assigning access.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {inert && (
        <p className="text-sm text-muted-foreground">
          This member sees every brand via their role. Assignments are stored
          but have no effect unless they become a creator.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {brands.map((brand) => {
          const isAssigned = assigned.has(brand.id);
          return (
            <li
              key={brand.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <p className="min-w-0 truncate text-sm font-medium">
                {brand.name}
              </p>
              <Button
                type="button"
                size="sm"
                variant={isAssigned ? "ghost" : "outline"}
                disabled={pendingId === brand.id}
                onClick={() => toggle(brand, isAssigned)}
              >
                {isAssigned ? "Unassign" : "Assign"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
