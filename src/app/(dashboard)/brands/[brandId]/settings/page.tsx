import Link from "next/link";
import { notFound } from "next/navigation";
import { EditBrandForm } from "@/components/features/brands/edit-brand-form";
import { getAuthCtx } from "@/server/auth/context";
import { getBrandById } from "@/server/dal/brands";
import { NotFoundError } from "@/server/domain/errors";

// Thin route (§5): scoped DAL read + render. `params` is a Promise in Next 16.
export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const ctx = await getAuthCtx();

  let brand;
  try {
    brand = await getBrandById(ctx, brandId);
  } catch (error) {
    // Cross-org / unassigned / nonexistent are all the same 404 shape (§7).
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Editing is owner/admin only; other roles that can read a brand see it
  // read-only. Enforcement is server-side in the update action (§7).
  const canEdit = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/brands"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Brands
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{brand.name}</h1>
      </div>

      {canEdit ? (
        <EditBrandForm
          brand={{
            id: brand.id,
            name: brand.name,
            timezone: brand.timezone,
          }}
        />
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{brand.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Timezone</dt>
            <dd>{brand.timezone}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
