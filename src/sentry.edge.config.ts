import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env/server";

// A6 — edge runtime (proxy.ts, edge routes). Same errors-only posture as the
// server config; the missing-DSN WARN lives in sentry.server.config.ts so it
// fires once at server boot rather than per edge invocation.
const dsn = env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
