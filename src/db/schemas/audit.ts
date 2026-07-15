import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

/**
 * audit_log (PRD §4, AGENTS.md §6.6) — every mutation and security-relevant
 * auth event records a row here. Hand-written (NOT better-auth-CLI-owned):
 * lives in its own file so `npm run auth:schema` regeneration of `auth.ts`
 * can never clobber it.
 *
 * `org_id` is nullable ON PURPOSE: auth events (sign-in, sign-up, password
 * reset) occur before or without an active organization (ADR-011). Every
 * org-scoped mutation recorded via the DAL (A5, AGENTS.md §6) MUST set it.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    // PRD §4: domain tables use uuid v7 (time-ordered). Neon runs Postgres 18,
    // which ships uuidv7() natively.
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: text("org_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    // 'user' (auth events, no org context yet) | 'member' | 'portal_token' | 'system'
    actorType: text("actor_type").notNull(),
    // user.id for auth events; member.id / portal_tokens.id later; null when
    // unattributable (e.g. failed sign-in for an unknown email).
    actorId: text("actor_id"),
    // Dot-namespaced, e.g. 'auth.sign_in.succeeded', 'post.approve'.
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Failure reasons, attempted email, future entity diffs — NEVER secrets.
    metadata: jsonb("metadata"),
    // AGENTS.md §9: timestamptz. (CLI-generated auth tables predate this rule.)
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_org_created_idx").on(table.orgId, table.createdAt),
    index("audit_log_action_created_idx").on(table.action, table.createdAt),
    index("audit_log_actor_idx").on(table.actorId),
  ],
);
