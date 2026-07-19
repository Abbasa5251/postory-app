import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";
import { requireBrand } from "../_lib/require-brand";

export default async function PostsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  await requireBrand(brandId);
  return <ComingSoon title="Posts" icon={<FileText className="size-6" />} />;
}
