import { Building2 } from "lucide-react";
import Link from "next/link";
import { NewBrandDialog } from "@/components/features/brands/new-brand-dialog";
import { PageHeader } from "@/components/features/shell/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthCtx } from "@/server/auth/context";
import { listBrands } from "@/server/dal/brands";

// Thin route (AGENTS.md §5): compose a DAL read + render. The (dashboard)
// layout has already gated session + active org, so getAuthCtx() resolves.
export default async function BrandsPage() {
  const ctx = await getAuthCtx();
  const brands = await listBrands(ctx);
  // UX only (§7): the "brand:create" authorize gate in the action is the real
  // enforcement — this just hides a button that would 403 for other roles.
  const canCreateBrand = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Brands"
        description="Every client brand in your agency."
        actions={canCreateBrand ? <NewBrandDialog /> : undefined}
      />

      {brands.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="No brands yet"
          description={
            canCreateBrand
              ? "Create your first client brand to start connecting accounts and composing posts."
              : "No brands have been created for this agency yet."
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Link
                href={`/brands/${brand.id}/dashboard`}
                className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="transition-colors hover:border-ring">
                  <CardHeader>
                    <CardTitle>{brand.name}</CardTitle>
                    <CardDescription>{brand.timezone}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
