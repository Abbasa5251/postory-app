import { defineRelationsPart, sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { createdAt, uuidV7Pk } from "./_helpers";

/**
 * webhook_events (PRD §4, ADR-006) — ingestion log for Stripe and Zernio:
 * verify signature → insert here (unique per provider event id = replay-safe)
 * → 200 fast → process via Inngest. Immutable apart from processed_at/error,
 * which the processor stamps.
 *
 * org_id is NULLABLE on purpose (like audit_log): the event arrives before
 * org resolution; the processor back-fills it. OpenRouter is synchronous —
 * extending the provider set is a deliberate migration (ADR-006).
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuidV7Pk(),
    orgId: text("org_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "webhook_events_provider_check",
      sql`${t.provider} IN ('stripe', 'zernio')`,
    ),
    uniqueIndex("webhook_events_provider_event_uidx").on(
      t.provider,
      t.providerEventId,
    ),
    // Worker pickup scan touches only the unprocessed tail.
    index("webhook_events_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
    index("webhook_events_org_idx").on(t.orgId),
  ],
);

export const webhooksRelations = defineRelationsPart({ webhookEvents }, () => ({
  // No RQB traversals yet; keyed so the table is reachable via db.query.
  webhookEvents: {},
}));
