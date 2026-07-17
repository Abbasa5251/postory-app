import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env/client";

// A6 — browser runtime. Auto-loaded by Next.js (instrumentation-client.ts).
// Errors-only: no tracing, no Session Replay (it records tenant DOM — a PII
// risk for a multi-tenant app), no Feedback widget.
const dsn = env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
