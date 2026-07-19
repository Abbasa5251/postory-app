import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Standalone deploy-time migration runner for the one-shot `migrate` compose
// service (docker-compose.yml). Run once, before the app starts, gated by
// `depends_on: condition: service_completed_successfully`.
//
// Intentionally NOT wired through src/lib/env: that schema validates the full
// app runtime surface (Resend, Zernio, Redis, …) which a migrate-only
// container has no reason to carry. A migrator needs exactly one input — the
// database URL.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

// Advisory-lock key (arbitrary int8 constant): serializes concurrent migrate
// runs — e.g. a manual re-run racing the compose service — so they queue
// instead of racing the same DDL (the drizzle migrator takes no lock of its
// own). The one-shot service already makes this a single actor; the lock is
// belt-and-suspenders.
const MIGRATION_LOCK_KEY = 4_070_218_011;

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  // Hold the advisory lock on ONE dedicated session for its whole lifetime —
  // pg_advisory_lock/unlock must run on the same connection to pair up.
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    // node-postgres migrator wraps the pending batch in a single transaction:
    // a failed migration rolls back rather than leaving a half-applied schema.
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: "./src/db/migrations",
    });
    console.log("[migrate] migrations applied");
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_LOCK_KEY,
      ]);
    } catch {
      // Best-effort: the lock is released anyway when the session closes below.
    }
    lockClient.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] migration failed", error);
  process.exit(1);
});
