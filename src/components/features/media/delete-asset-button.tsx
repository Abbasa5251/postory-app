"use client";

import { Trash2 } from "lucide-react";
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
import { deleteMedia } from "@/server/actions/media";

/**
 * Delete a library asset (D4). Confirms first (destructive + permanent). When
 * the asset is in use it warns with the post count (founder call: allow, don't
 * block — dangling refs degrade gracefully). Dialog stays open on failure so the
 * message shows; the `post:create` gate on the action is the real enforcement.
 */
export function DeleteAssetButton({
  brandId,
  mediaId,
  usageCount,
}: {
  brandId: string;
  mediaId: string;
  usageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { pending, message, run } = useActionForm(deleteMedia, {
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  const posts = `${usageCount} post${usageCount === 1 ? "" : "s"}`;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-destructive"
            aria-label="Delete asset"
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
          <AlertDialogDescription>
            {usageCount > 0
              ? `This asset is used in ${posts}. Deleting it removes the file permanently, and it will no longer appear in those posts’ previews. This can’t be undone.`
              : "This permanently deletes the asset and its file. This can’t be undone."}
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
            onClick={() => run({ brandId, mediaId })}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
