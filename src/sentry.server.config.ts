import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env/server";
import { shouldEnforceProductionEnv } from "@/lib/env/runtime";

// A6 — Node server runtime. Errors-only launch posture: no performance tracing
// (tracesSampleRate 0), no Session Replay, no PII (§7/§9). Loaded from
// instrumentation.ts register() on the nodejs runtime.
const dsn = env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
});

if (!dsn && shouldEnforceProductionEnv()) {
  // Optional-everywhere (A6): a production server with no DSN is flying blind,
  // so make it visible — but WARN, never throw. Observability being absent
  // must not brick a deploy the way the redis/email guards do.
  console.warn(
    "[observability] SENTRY_DSN is not set — server errors are not being reported to Sentry.",
  );
}
