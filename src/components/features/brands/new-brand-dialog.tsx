"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useActionForm } from "@/hooks/use-action-form";
import { createBrand } from "@/server/actions/brands";
import { BrandTimezoneField } from "./brand-timezone-field";

// Smart default (B1): pre-select the creator's own timezone. Falls back to UTC
// if the runtime can't resolve one. Evaluated client-side only (the dialog
// mounts on open), so no SSR/browser mismatch.
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * "New brand" dialog (B1). Name + timezone only — logo/colors/approval land
 * with the epics that consume them. Submits to the `createBrand` action and
 * surfaces the typed `ActionResult` (field errors inline, a general message
 * otherwise). No Zernio work: the profile is provisioned lazily in B3.
 */
export function NewBrandDialog({
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  /** Controlled open state (e.g. opened from the sidebar brand switcher). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in button when another surface opens the dialog. */
  showTrigger?: boolean;
} = {}) {
  const router = useRouter();
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp : internalOpen;
  const [timezone, setTimezone] = useState(browserTimeZone);
  const { pending, message, fieldErrors, reset, run } = useActionForm(
    createBrand,
    {
      onSuccess: (data) => {
        toast.success(`Brand "${data.name}" created`);
        setOpen(false);
        // Land on the new brand so it's active in the shell (and the sidebar
        // switcher/list refresh via the re-run layout).
        router.push(`/brands/${data.id}/dashboard`);
      },
    },
  );

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  }

  // Reset transient form state whenever the dialog closes (handled here, not
  // in an effect — it's a user event, not derived state).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
      setTimezone(browserTimeZone());
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    void run({ name, timezone });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger && (
        <AlertDialogTrigger
          render={
            <Button>
              <Plus />
              New brand
            </Button>
          }
        />
      )}

      <AlertDialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>New brand</AlertDialogTitle>
            <AlertDialogDescription>
              Create a brand to manage a client&apos;s social presence. You can
              connect accounts and start composing once it exists.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-4">
            <Field data-invalid={!!fieldErrors?.name}>
              <Label htmlFor="brand-name">Name</Label>
              <Input
                id="brand-name"
                name="name"
                autoFocus
                required
                placeholder="Acme Co"
                disabled={pending}
                aria-invalid={!!fieldErrors?.name}
              />
              <FieldError>{fieldErrors?.name?.[0]}</FieldError>
            </Field>

            <BrandTimezoneField
              value={timezone}
              onValueChange={setTimezone}
              disabled={pending}
              error={fieldErrors?.timezone?.[0]}
            />

            {message && <p className="text-sm text-destructive">{message}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={pending || !timezone}>
              {pending && <Spinner />}
              Create brand
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
