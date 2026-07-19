/**
 * Day-1 brand setup checklist (pure; isomorphic-safe). Kept out of the route so
 * the dashboard page stays thin — it composes DAL reads and passes the results
 * here. Only steps for shipped features appear: "Schedule your first post" is
 * added once the composer supports scheduling (Epic F), so the checklist stays
 * completable and doesn't count an unavailable step.
 */
export type SetupStep = {
  label: string;
  done: boolean;
  /** Where the step's action lives, or null when there's nothing to open. */
  href: string | null;
};

export function buildSetupChecklist(input: {
  brandId: string;
  hasAccounts: boolean;
  hasTeammates: boolean;
}): SetupStep[] {
  return [
    { label: "Create your first brand", done: true, href: null },
    {
      label: "Connect a social account",
      done: input.hasAccounts,
      href: `/brands/${input.brandId}/accounts`,
    },
    {
      label: "Invite a teammate",
      done: input.hasTeammates,
      href: "/organization/members",
    },
  ];
}
