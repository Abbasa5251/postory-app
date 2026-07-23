import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * credit_ledger (PRD §4, ADR-005) — APPEND-ONLY. Never UPDATE or DELETE a
 * row; corrections are compensating entries. Balance = SUM(delta) per org
 * (materialized, invalidated on write — Epic H). Reserve (debit) happens
 * BEFORE the OpenRouter call; settle/refund after. Append-only is enforced
 * at the PG layer by triggers rejecting UPDATE/DELETE (see the
 * credit_ledger_append_only migration — triggers can't be expressed in
 * drizzle schema) on top of the DAL contract (AGENTS.md §16); the schema
 * deliberately has no updated_at to update.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    // + grant / − debit; credits are integers (AGENTS.md §9).
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    // Polymorphic reference (generation job uuid, Stripe invoice id, pack
    // purchase) — no FK by design; the ledger outlives what it references.
    refType: text("ref_type"),
    refId: text("ref_id"),
    // ADR-005: monthly plan grants expire at period end; packs at 12 months.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "credit_ledger_reason_check",
      sql`${t.reason} IN ('trial_grant', 'plan_grant', 'pack', 'debit', 'refund', 'expiry')`,
    ),
    index("credit_ledger_org_created_idx").on(t.orgId, t.createdAt),
    // Expiry-sweep scan (H4) only ever looks at expirable grants.
    index("credit_ledger_org_expires_idx")
      .on(t.orgId, t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

/**
 * subscriptions (PRD §4, ADR-004) — Stripe mirror, one row per org, upserted
 * by the Stripe webhook processor (H3). Entitlement gates read THIS row,
 * never Stripe at request time.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    tier: text("tier").notNull(),
    // Stripe-owned vocabulary (active, trialing, past_due, …) — mirrored
    // verbatim, deliberately NO CHECK: the vendor may extend the set.
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    // Opaque — plan caps consumed by src/server/domain/entitlements.ts (Epic H).
    entitlements: jsonb("entitlements").notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      "subscriptions_tier_check",
      sql`${t.tier} IN ('starter', 'studio', 'agency', 'enterprise')`,
    ),
    uniqueIndex("subscriptions_org_uidx").on(t.orgId),
    uniqueIndex("subscriptions_stripe_customer_uidx").on(t.stripeCustomerId),
    uniqueIndex("subscriptions_stripe_subscription_uidx").on(
      t.stripeSubscriptionId,
    ),
  ],
);

/**
 * credit_rates (PRD §7.2, ADR-012) — GLOBAL config table: model ids + credit
 * prices. The single source of truth consumed via src/server/dal/credits.ts
 * (AGENTS.md §4) — model ids and prices are never hardcoded. Deliberately has
 * NO org_id: it is platform config, not tenant data — the documented
 * exception to AGENTS.md §6.4, flagged in PR notes. Seeding lands with
 * Epic D/H.
 */
export const creditRates = pgTable(
  "credit_rates",
  {
    id: uuidV7Pk(),
    // Billing action tier; several models can share one action (e.g. FLUX.2
    // and Seedream are both 'image_standard'). Video tiers reserved (D7).
    action: text("action").notNull(),
    // OpenRouter model id, e.g. 'black-forest-labs/flux-2'.
    modelId: text("model_id").notNull(),
    credits: integer("credits").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check(
      "credit_rates_action_check",
      // 'moderation' (D5) is a 0-credit gate action: it holds the vision model id
      // used to classify generated content (ADR-012 — model ids never hardcoded),
      // but never moves the credit_ledger.
      sql`${t.action} IN ('copy', 'image_standard', 'image_premium', 'video_standard', 'video_premium', 'moderation')`,
    ),
    uniqueIndex("credit_rates_model_uidx").on(t.modelId),
    index("credit_rates_action_active_idx")
      .on(t.action)
      .where(sql`${t.isActive}`),
  ],
);

export const billingRelations = defineRelationsPart(
  { creditLedger, subscriptions, creditRates },
  () => ({
    // No RQB traversals yet; keyed so the tables are reachable via db.query.
    creditLedger: {},
    subscriptions: {},
    creditRates: {},
  }),
);
