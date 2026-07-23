import "server-only";
import { adaptCopyJob } from "./generation/copy.adapt.requested";
import { generateCopyJob } from "./generation/copy.requested";
import { generateImageJob } from "./generation/image.requested";
import { healthPing } from "./system/health.ping";

/**
 * The registry of every Inngest function, served at /api/inngest. Add each new
 * job here (AGENTS.md §10: one function per file). Generation/publishing jobs
 * join this list as their epics land (D, F).
 */
export const functions = [
  healthPing,
  generateCopyJob,
  adaptCopyJob,
  generateImageJob,
];
