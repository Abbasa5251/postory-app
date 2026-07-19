import { Compass } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Route-level not-found for dashboard pages (e.g. a brand the caller can't
// access — getBrandById 404s cross-org/unassigned/nonexistent the same way, §7).
export default function DashboardNotFound() {
  return (
    <EmptyState
      className="min-h-[60vh] border-solid"
      icon={<Compass className="size-5" />}
      title="Page not found"
      description="This page doesn't exist, or you don't have access to it."
      action={
        <Link href="/dashboard" className={buttonVariants()}>
          Back to dashboard
        </Link>
      }
    />
  );
}
