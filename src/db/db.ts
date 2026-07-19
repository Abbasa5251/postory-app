import { neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env/server";
import { relations } from "@/db/relations";

// Local dev: when DATABASE_URL points at localhost, route the neon-http driver's
// fetch at the local-neon-http-proxy container (docker-compose) instead of Neon
// cloud. Keeps the driver — and db.batch — identical to production while queries
// run ~1-3ms against local Postgres instead of ~220ms to Neon us-east-1.
if (["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname)) {
  neonConfig.fetchEndpoint = "http://localhost:4444/sql";
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
}

export const db = drizzle(env.DATABASE_URL, { relations });
