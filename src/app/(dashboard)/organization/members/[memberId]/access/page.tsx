import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  type AccessBrand,
  MemberAccessSection,
} from "@/components/features/brands/member-access-section";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { auth } from "@/server/auth/auth";
import { getAuthCtx } from "@/server/auth/context";
import { listBrandIdsForMember } from "@/server/dal/brand-members";
import { listBrands } from "@/server/dal/brands";

// Thin route (§5): gate + scoped DAL reads + render. `params` is a Promise in
// Next 16. This is the member-centric mirror of the Brand settings Access
// section — same rows, seen from one member across every brand.
export default async function MemberAccessPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const ctx = await getAuthCtx();

  // Brand assignment is owner/admin only (the `brand:assign` gate the actions
  // enforce, §7). A non-owner/admin gets the same 404 shape as a bad id — no
  // signal that this surface exists.
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();

  // listMembers defaults to the active org and self-verifies membership; an
  // agency has ≤10 seats (D1) so the default page is the whole team. Finding
  // the target here is the tenancy check: a member id from another org is not
  // in this list → 404 (never confirm it exists elsewhere).
  const [memberList, brands] = await Promise.all([
    auth.api.listMembers({ headers: await headers() }),
    listBrands(ctx),
  ]);
  const target = memberList.members.find((m) => m.id === memberId);
  if (!target) notFound();

  const assignedBrandIds = await listBrandIdsForMember(ctx, memberId);

  const accessBrands: AccessBrand[] = brands.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/organization/members"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Members
        </Link>
        <h1 className="font-heading text-2xl font-semibold">
          {target.user.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {target.user.email} ·{" "}
          {ROLE_LABELS[target.role as Role] ?? target.role}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">Brand access</h2>
          <p className="text-sm text-muted-foreground">
            Creators see only the brands they&apos;re assigned to. Owners,
            admins, and approvers see every brand.
          </p>
        </div>
        <MemberAccessSection
          memberId={target.id}
          memberName={target.user.name}
          memberRole={target.role}
          brands={accessBrands}
          assignedBrandIds={assignedBrandIds}
        />
      </section>
    </div>
  );
}
