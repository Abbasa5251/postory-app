import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";
import { requireBrand } from "../_lib/require-brand";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  await requireBrand(brandId);
  return (
    <ComingSoon title="Analytics" icon={<BarChart3 className="size-6" />} />
  );
}
