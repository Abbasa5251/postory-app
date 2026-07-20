import "server-only";
import { inngest } from "../client";
import { healthPingEvent } from "../events";

/**
 * Trivial wiring check (AGENTS.md §10): proves the serve endpoint registers
 * with the dev server and that events round-trip. Not a product job — send
 * `system/health.ping` from the Inngest dev UI and confirm the run succeeds.
 *
 * Real jobs (generation/publishing) declare a concurrency key on `orgId` and a
 * credit-refunding failure path; this one has no side effects, so it needs
 * neither.
 */
export const healthPing = inngest.createFunction(
  { id: "system-health-ping", retries: 0, triggers: [healthPingEvent] },
  async ({ event }) => {
    return { ok: true, echo: event.data ?? null };
  },
);
