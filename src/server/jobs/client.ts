import "server-only";
import { Inngest } from "inngest";
import { env } from "@/lib/env/server";

/**
 * The shared Inngest client (ADR-003: all AI generation & publishing run in
 * Inngest workers, never request handlers). One app id for all of POSTORY.
 *
 * Keys come through `env` (AGENTS.md §15 — never `process.env` in our code);
 * the SDK would also read INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY from the
 * environment directly, but we pass them explicitly to keep the single-source
 * env contract. In local dev set INNGEST_DEV=1 (a platform flag the SDK reads)
 * and neither key is required; production runs in Cloud mode and needs both.
 *
 * `isDev` is deliberately NOT hardcoded — it is driven by INNGEST_DEV so it
 * can never silently ship dev mode to production.
 *
 * Typed events are defined with `eventType()` in ./events and used both as
 * triggers and at `inngest.send(event.create(...))` sites.
 */
export const inngest = new Inngest({
  id: "postory",
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
});
