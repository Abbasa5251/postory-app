import * as z from "zod";

/**
 * Social-account action inputs (B3). Canonical zod home per AGENTS.md §4.
 * Validated at the server-action boundary (§7/§9). Ids are opaque strings; the
 * real authorization is the DAL's org+brand scoping, not their format.
 */
export const refreshAccountsSchema = z.object({
  brandId: z.string().min(1),
});

export const disconnectAccountSchema = z.object({
  brandId: z.string().min(1),
  accountId: z.string().min(1),
});

export type RefreshAccountsInput = z.infer<typeof refreshAccountsSchema>;
export type DisconnectAccountInput = z.infer<typeof disconnectAccountSchema>;
