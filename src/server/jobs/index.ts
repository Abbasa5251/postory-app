import "server-only";
import { healthPing } from "./system/health.ping";

/**
 * The registry of every Inngest function, served at /api/inngest. Add each new
 * job here (AGENTS.md §10: one function per file). Generation/publishing jobs
 * join this list as their epics land (C2, D, F).
 */
export const functions = [healthPing];
