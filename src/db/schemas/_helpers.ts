import { sql } from "drizzle-orm";
import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { member, organization } from "./auth";

/**
 * Column factories shared by every domain table (AGENTS.md §6, PRD §4).
 * Each call returns a FRESH builder — drizzle column builders are stateful,
 * so a shared instance across tables would corrupt their runtime config.
 * No tables here: drizzle-kit scans this whole directory for table exports.
 */

// PRD §4: domain tables use uuid v7 (time-ordered). Neon runs Postgres 18,
// which ships uuidv7() natively.
export function uuidV7Pk() {
  return uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
}

/**
 * AGENTS.md §6.4: every domain table carries org_id → better-auth
 * organization.id (text PK). Cascade: org deletion is full tenant teardown.
 * (webhook_events defines its own nullable org_id — events arrive before
 * org resolution, same rationale as audit_log.)
 */
export function orgId() {
  return text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });
}

/**
 * Attribution FK → better-auth member.id. Nullable + SET NULL: removing a
 * seat must never destroy content or history. (brand_members is the
 * deliberate exception — a pure join row dies with the membership.)
 */
export function memberRef(columnName: string) {
  return text(columnName).references(() => member.id, {
    onDelete: "set null",
  });
}

// AGENTS.md §9: timestamptz. ($onUpdate is app-layer, matching auth.ts —
// updated_at won't tick under raw SQL.)
export function createdAt() {
  return timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
}

export function timestamps() {
  return {
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  };
}
