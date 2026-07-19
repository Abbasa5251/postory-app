import { config } from "dotenv";
// Load .env.local first (wins per-key), then .env for the rest — mirrors
// Next.js precedence so `npm run db:migrate` targets the same DB the app does.
config({ path: ".env.local" });
config({ path: ".env" });

import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schemas",
  dialect: "postgresql",
  dbCredentials: { url },
});
