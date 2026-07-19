import { CheckCircle2 } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";
import { requireBrand } from "../_lib/require-brand";

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  await requireBrand(brandId);
  return (
    <ComingSoon title="Approvals" icon={<CheckCircle2 className="size-6" />} />
  );
}
