import "server-only";
import { eventType } from "inngest";

/**
 * Typed event definitions (Inngest v4 `eventType`). Each is used both as a
 * function trigger and for `inngest.send(<event>.create(data))`, so payloads
 * are type-checked at every send site. Generation/publishing events join this
 * file as their epics land (C2, D, F).
 *
 * Schemas must be transform-free (Inngest requires input === output); do the
 * real validation in the job with the app's zod schemas.
 */

/** Wiring check only — no product meaning (see system/health.ping). */
export const healthPingEvent = eventType("system/health.ping");
