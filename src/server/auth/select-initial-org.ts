// NOTE: no `import "server-only"` here — this module sits in the import graph of
// `auth.ts`, which the better-auth CLI loads for schema generation and which
// rejects a 'server-only' import anywhere in that graph (same constraint as
// auth.ts / permissions.ts). It holds no I/O and no secrets: the caller passes
// its own better-auth adapter.
import type { DBAdapter } from "better-auth";

/**
 * Single source of the "default active organization" policy: the user's
 * EARLIEST membership (`member.createdAt` ascending). Shared by sign-in
 * (`auth.ts` session-create hook) and gate recovery (`active-org.ts`) so both
 * pick the SAME tenant — an invited user's earliest membership need not be
 * their earliest-*created* org, so comparing org creation time would diverge.
 *
 * The better-auth-owned `member` table is read through the better-auth adapter,
 * never drizzle (AGENTS.md §6). Returns null when the user belongs to no org.
 */
export async function selectInitialOrganizationId(
  adapter: Pick<DBAdapter, "findMany">,
  userId: string,
): Promise<string | null> {
  const members = await adapter.findMany<{ organizationId: string }>({
    model: "member",
    where: [{ field: "userId", value: userId }],
    sortBy: { field: "createdAt", direction: "asc" },
    limit: 1,
  });
  return members[0]?.organizationId ?? null;
}
