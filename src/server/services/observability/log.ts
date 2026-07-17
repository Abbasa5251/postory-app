import "server-only";

/**
 * A6 — structured operational logging. Each call writes one JSON line to
 * stdout; on Vercel that stream is forwarded to Axiom via a Log Drain (config
 * out-of-band, no dependency and no token in the bundle). The transport is
 * deliberately just stdout so it can be swapped for a direct Axiom SDK later
 * without touching call sites.
 *
 * Distinct from `audit_log` (A4): that records tamper-relevant domain events in
 * the DB; this is fire-and-forget telemetry. Never log secrets or PII.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields?: Fields): void {
  const record = { ...fields, level, time: new Date().toISOString(), message };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export const log = {
  debug: (message: string, fields?: Fields) => emit("debug", message, fields),
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
};
