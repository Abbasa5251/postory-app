import "server-only";

/**
 * Server actions (AGENTS.md §7 / ADR-013). `withAction` is the wrapper every
 * mutation is authored through; feature actions live in sibling files here
 * (e.g. brands.ts) and land with their epics.
 */
export { withAction } from "./with-action";
export type { ActionResult, ActionError } from "./types";
