"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useActionForm } from "@/hooks/use-action-form";
import { updateBrand } from "@/server/actions/brands";
import { BrandTimezoneField } from "./brand-timezone-field";

/**
 * Brand settings edit form (B1.2). Name + timezone only (same fields as
 * create); the slug is immutable and not shown. Submits to `updateBrand` and
 * surfaces the typed `ActionResult` (field errors inline, general message
 * otherwise).
 */
export function EditBrandForm({
  brand,
}: {
  brand: { id: string; name: string; timezone: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(brand.name);
  const [timezone, setTimezone] = useState(brand.timezone);
  const { pending, message, fieldErrors, run } = useActionForm(updateBrand, {
    onSuccess: () => {
      toast.success("Brand updated");
      // Stay on settings and re-render server data (name shows in the sidebar).
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run({ id: brand.id, name, timezone });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!fieldErrors?.name}>
          <Label htmlFor="brand-name">Workspace name</Label>
          <Input
            id="brand-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
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
      </div>

      {message && <p className="text-sm text-destructive">{message}</p>}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending || !name.trim() || !timezone}>
          {pending && <Spinner />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
