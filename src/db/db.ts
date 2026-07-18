import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env/server";
import { relations } from "./relations";

// Standard node-postgres (pg) driver over a plain TCP connection — no vendor
// SDK, no HTTP proxy. Works against any Postgres, including a local container
// or a cloud provider (Neon/Supabase/RDS) via its direct connection string.
// The pool connects lazily on first query, so constructing it here is safe at
// build time (page-data collection never issues a query).
export const db = drizzle(env.DATABASE_URL, { relations });
