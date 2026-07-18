import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env/server";
import { relations } from "./relations";

// node-postgres (pg) driver rather than neon-http: POSTORY now runs as a
// long-lived containerized server, not per-request serverless. A persistent
// TCP Pool fits that model, and — unlike the neon-http driver — it supports
// interactive transactions, which the programmatic migrator (src/db/migrate.ts)
// relies on to wrap each migration batch in a rollback-able transaction.
//
// SSL is driven by the connection string: a managed Postgres URL carries
// `?sslmode=require` (pg enables TLS accordingly); an in-network container
// Postgres omits it and connects plaintext. One long-lived Pool per process
// (module singleton) — never construct another elsewhere.
const pool = new Pool({ connectionString: env.DATABASE_URL });

// RQB v2 `relations` is driver-agnostic — the object and every relational query
// (./relations.ts) are unchanged by the driver swap.
export const db = drizzle({ client: pool, relations });
