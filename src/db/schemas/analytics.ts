import { defineRelationsPart, sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { postPlatforms } from "./posts";
import { createdAt, orgId, uuidV7Pk } from "./_helpers";

/**
 * analytics_snapshots (PRD §4, G1) — immutable per-(post, platform) metric
 * captures synced from the Zernio analytics API at fixed windows after
 * publish (no updated_at; a re-sync of the same window upserts is NOT
 * allowed — the unique constraint makes each window a single capture).
 * Column is capture_window because WINDOW is a PG reserved word.
 */
export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    postPlatformId: uuid("post_platform_id")
      .notNull()
      .references(() => postPlatforms.id, { onDelete: "cascade" }),
    captureWindow: text("capture_window").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Opaque — Zernio metrics payload (reach, likes, comments, shares,
    // clicks, views), shaped by Epic G.
    metrics: jsonb("metrics").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "analytics_snapshots_capture_window_check",
      sql`${t.captureWindow} IN ('24h', '72h', '7d', '30d')`,
    ),
    uniqueIndex("analytics_snapshots_platform_window_uidx").on(
      t.postPlatformId,
      t.captureWindow,
    ),
    index("analytics_snapshots_org_captured_idx").on(t.orgId, t.capturedAt),
  ],
);

export const analyticsRelations = defineRelationsPart(
  { analyticsSnapshots, postPlatforms },
  (r) => ({
    analyticsSnapshots: {
      postPlatform: r.one.postPlatforms({
        from: r.analyticsSnapshots.postPlatformId,
        to: r.postPlatforms.id,
      }),
    },
  }),
);
