import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton for dashboard pages (renders inside the shell's
// content area while a server component streams).
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
