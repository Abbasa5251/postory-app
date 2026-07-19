import { redirect } from "next/navigation";
import { getAuthCtx } from "@/server/auth/context";
import { listBrands } from "@/server/dal/brands";

// Brand-centric shell: /dashboard is not a screen — it routes to the active
// (default) brand's dashboard. Brand-less users go to /brands to create one
// (the empty state + create dialog live there).
export default async function DashboardRedirectPage() {
  const ctx = await getAuthCtx();
  const brands = await listBrands(ctx);
  if (brands.length === 0) redirect("/brands");
  redirect(`/brands/${brands[0].id}/dashboard`);
}
