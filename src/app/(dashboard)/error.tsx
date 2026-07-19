"use client";

import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Route-level error boundary for dashboard pages. Unlike global-error (which
// replaces the root layout), this renders inside the shell + app styles, so it
// reuses EmptyState. Last-resort report to Sentry, mirroring global-error.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <EmptyState
      className="min-h-[60vh] border-solid"
      icon={<TriangleAlert className="size-5" />}
      title="Something went wrong"
      description="An unexpected error occurred. You can try again — if it keeps happening, please contact support."
      action={<Button onClick={() => reset()}>Try again</Button>}
    />
  );
}
