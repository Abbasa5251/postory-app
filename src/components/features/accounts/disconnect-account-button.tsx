"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useActionForm } from "@/hooks/use-action-form";
import { disconnectAccount } from "@/server/actions/accounts";

/**
 * Disconnect control (#31). Confirms first (destructive: stops publishing +
 * billing and removes the account), then runs the `withAction` disconnect and
 * refreshes. Rendered only for managers (the account:disconnect gate is the
 * real enforcement). Dialog stays open on failure so the message is visible.
 */
export function DisconnectAccountButton({
  brandId,
  accountId,
  handle,
}: {
  brandId: string;
  accountId: string;
  handle: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { pending, message, run } = useActionForm(disconnectAccount, {
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
          >
            Disconnect
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {handle}?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops publishing and billing for this account. You can
            reconnect it later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => run({ brandId, accountId })}
          >
            {pending ? "Disconnecting…" : "Disconnect"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
