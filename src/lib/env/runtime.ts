// NOTE: no `import 'server-only'` here — consumers include
// src/server/services/redis/client.ts, which sits in the better-auth CLI's
// load graph (it rejects 'server-only').

// NODE_ENV / NEXT_PHASE / VERCEL read directly: platform constants, not
// modeled by t3-env. `next build` runs with NODE_ENV=production but sets
// NEXT_PHASE=phase-production-build (next/constants), so a bare NODE_ENV
// check cannot tell a production server from a local `next build`.
//
// Production env guards (redis, email) must fire when a missing var is a
// real misconfiguration:
//   - production runtime (server boot / request handling), and
//   - Vercel builds (VERCEL=1 — the deploy env is attached, so failing the
//     build catches the misconfig before it ships; PRD §A4 / ADR-011),
// but never local or CI `next build`, which run without deploy secrets.
export function shouldEnforceProductionEnv(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  return !isBuildPhase || Boolean(process.env.VERCEL);
}
