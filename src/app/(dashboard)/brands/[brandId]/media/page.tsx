import { ImageIcon } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";
import { requireBrand } from "../_lib/require-brand";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  await requireBrand(brandId);
  return (
    <ComingSoon title="Media library" icon={<ImageIcon className="size-6" />} />
  );
}
