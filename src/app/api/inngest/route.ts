import { serve } from "inngest/next";
import { functions } from "@/server/jobs";
import { inngest } from "@/server/jobs/client";

/**
 * Inngest serve endpoint (ADR-003). Thin by design (AGENTS.md §5): it only
 * exposes the function registry to Inngest — no business logic. The path must
 * stay `/api/inngest` for the dev server's auto-discovery.
 *
 * v4: signing key / event key live on the client (src/server/jobs/client.ts),
 * not here — serve() only takes client + functions.
 */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
