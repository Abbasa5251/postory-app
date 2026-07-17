"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { timeZoneOptions } from "@/lib/timezones";

/**
 * Searchable IANA timezone picker, shared by the brand create + edit forms
 * (B1). Controlled: the parent owns the value. The server re-validates on
 * submit (§7), so this is UX only.
 */
export function BrandTimezoneField({
  value,
  onValueChange,
  disabled,
  error,
  id = "brand-timezone",
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  id?: string;
}) {
  return (
    <Field data-invalid={!!error}>
      <Label htmlFor={id}>Timezone</Label>
      <Combobox
        items={timeZoneOptions}
        value={value}
        onValueChange={(next) => onValueChange(next ?? "")}
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          placeholder="Search timezone…"
          aria-invalid={!!error}
        />
        <ComboboxContent>
          <ComboboxEmpty>No timezone found.</ComboboxEmpty>
          <ComboboxList>
            {(tz: string) => (
              <ComboboxItem key={tz} value={tz}>
                {tz}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
