import { NewBrandDialog } from "@/components/features/brands/new-brand-dialog";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">Brands</h1>
        {canCreateBrand && <NewBrandDialog />}
      </div>

      {brands.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardHeader>
            <CardTitle>No brands yet</CardTitle>
            <CardDescription>
              Create your first brand to get started.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{brand.name}</CardTitle>
                  <CardDescription>{brand.timezone}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
