import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * org_settings (PRD §4) — 1:1 companion to the better-auth organization row.
 * Domain state we own (trial lifecycle, org defaults) lives here instead of
 * hand-editing the CLI-owned organization table.
 */
export const orgSettings = pgTable(
  "org_settings",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    // ADR-010: trial state on the org row, enforced server-side.
    // active → read_only (expiry) → disconnected (+7d) → subscribed (on subscribe).
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    trialState: text("trial_state").notNull().default("active"),
    // Opaque — hot-path tier/caps denormalization, shaped by Epic H.
    planSnapshot: jsonb("plan_snapshot"),
    // PRD §5: "Approving own post: org setting, default off."
    allowSelfApproval: boolean("allow_self_approval").notNull().default(false),
    // Opaque — remaining org-level defaults, shaped by later epics.
    defaults: jsonb("defaults"),
    ...timestamps(),
  },
  (t) => [
    check(
      "org_settings_trial_state_check",
      sql`${t.trialState} IN ('active', 'read_only', 'disconnected', 'subscribed')`,
    ),
    uniqueIndex("org_settings_org_uidx").on(t.orgId),
  ],
);

export const orgsRelations = defineRelationsPart({ orgSettings }, () => ({
  // No RQB traversals yet; keyed so the table is reachable via db.query.
  orgSettings: {},
}));
