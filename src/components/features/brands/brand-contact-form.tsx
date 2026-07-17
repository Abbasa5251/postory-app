"use client";

import { useRouter } from "next/navigation";
import { type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useActionForm } from "@/hooks/use-action-form";
import { updateBrandContact } from "@/server/actions/brands";

/**
 * Client contact email (B2). Single optional email; empty clears it. Read later
 * by the client portal (E4) and reports (G4).
 */
export function BrandContactForm({
  brand,
}: {
  brand: { id: string; clientContactEmail: string | null };
}) {
  const router = useRouter();
  const { pending, message, fieldErrors, run } = useActionForm(
    updateBrandContact,
    {
      onSuccess: () => {
        toast.success("Client contact saved");
        router.refresh();
      },
    },
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(
      new FormData(event.currentTarget).get("clientContactEmail") ?? "",
    );
    void run({ id: brand.id, clientContactEmail: email });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field data-invalid={!!fieldErrors?.clientContactEmail}>
        <Label htmlFor="client-contact-email">Client contact email</Label>
        <Input
          id="client-contact-email"
          name="clientContactEmail"
          type="email"
          placeholder="client@example.com"
          defaultValue={brand.clientContactEmail ?? ""}
          disabled={pending}
          aria-invalid={!!fieldErrors?.clientContactEmail}
        />
        <FieldError>{fieldErrors?.clientContactEmail?.[0]}</FieldError>
      </Field>

      {message && <p className="text-sm text-destructive">{message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Save contact
        </Button>
      </div>
    </form>
  );
}
