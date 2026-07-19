import { Calendar } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";
import { requireBrand } from "../_lib/require-brand";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  await requireBrand(brandId);
  return <ComingSoon title="Calendar" icon={<Calendar className="size-6" />} />;
}
