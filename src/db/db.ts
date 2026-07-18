import { neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env/server";
import { relations } from "./relations";

// Local/Docker: point the neon-http driver at a `local-neon-http-proxy`
// container instead of Neon's cloud endpoint. The proxy re-exposes a plain
// Postgres over Neon's HTTP wire protocol, so the driver — and the db.batch()
// atomicity template in dal/audit.ts — works byte-for-byte unchanged. The
// `host` handed to fetchEndpoint is the hostname parsed out of DATABASE_URL
// (i.e. the proxy's compose service name); only the endpoint we return here is
// actually contacted, over plain HTTP on the private compose network.
if (env.USE_LOCAL_NEON_PROXY) {
  const port = env.NEON_LOCAL_PROXY_PORT ?? 4444;
  neonConfig.fetchEndpoint = (host) => `http://${host}:${port}/sql`;
}

export const db = drizzle(env.DATABASE_URL, { relations });
