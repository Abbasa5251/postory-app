import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import { NewBrandDialog } from "@/components/features/brands/new-brand-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthCtx } from "@/server/auth/context";
import { listBrands } from "@/server/dal/brands";

// Brand-centric shell: /dashboard routes to the active (default) brand's
// dashboard. Brand-less users land here on a first-run empty state (the sidebar
// brand switcher owns switching + create once brands exist).
export default async function DashboardPage() {
  const ctx = await getAuthCtx();
  const brands = await listBrands(ctx);
  if (brands.length > 0) redirect(`/brands/${brands[0].id}/dashboard`);

  const canCreate = ctx.role === "owner" || ctx.role === "admin";
  return (
    <EmptyState
      className="min-h-[60vh]"
      icon={<Building2 className="size-5" />}
      title="No brands yet"
      description={
        canCreate
          ? "Create your first client brand to start connecting accounts and composing posts."
          : "No brands have been created for this agency yet."
      }
      action={canCreate ? <NewBrandDialog /> : undefined}
    />
  );
}
