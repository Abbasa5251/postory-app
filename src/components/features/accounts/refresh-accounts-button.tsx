"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useActionForm } from "@/hooks/use-action-form";
import { refreshBrandAccounts } from "@/server/actions/accounts";

/**
 * Manual reconcile trigger (#30): pulls Zernio's account list + health and
 * refreshes our rows, then re-renders. Interactive so the RSC page never
 * mutates during render.
 */
export function RefreshAccountsButton({ brandId }: { brandId: string }) {
  const router = useRouter();
  const { pending, message, run } = useActionForm(refreshBrandAccounts, {
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run({ brandId })}
      >
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
      {message && (
        <span role="alert" className="text-sm text-destructive">
          {message}
        </span>
      )}
    </div>
  );
}
