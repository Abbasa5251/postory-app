import { PageHeader } from "@/components/features/shell/page-header";
import { requireBrand } from "../_lib/require-brand";

// The brand's home. The day-1 checklist + empty-state panels land in A7.3.
export default async function BrandDashboardPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const brand = await requireBrand(brandId);

  return (
    <PageHeader
      title="Dashboard"
      description={`How ${brand.name} is doing across every connected account.`}
    />
  );
}
