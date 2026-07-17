"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/actions";

/**
 * Form glue for a `withAction` server action (ADR-013). Centralizes the
 * `ActionResult` envelope handling every form repeats — pending state, inline
 * `fieldErrors`, a general `message` for non-validation failures, and a
 * generic message if the action rejects (dev re-throw / network). The caller
 * supplies what success means via `onSuccess`.
 */
export function useActionForm<TInput, TData>(
  action: (input: TInput) => Promise<ActionResult<TData>>,
  { onSuccess }: { onSuccess?: (data: TData) => void } = {},
) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();

  function reset() {
    setMessage(undefined);
    setFieldErrors(undefined);
  }

  async function run(input: TInput) {
    setPending(true);
    reset();
    try {
      const result = await action(input);
      if (!result.ok) {
        // VALIDATION → inline field errors; everything else → general message.
        setFieldErrors(result.error.fieldErrors);
        if (result.error.code !== "VALIDATION")
          setMessage(result.error.message);
        return;
      }
      onSuccess?.(result.data);
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return { pending, message, fieldErrors, reset, run };
}
