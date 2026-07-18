import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Importing these runs their production env guards (ADR-011): a prod
    // server missing REDIS_URL / EMAIL_FROM fails at boot instead of on the
    // first request that pulls in the auth/email module graph. register()
    // never runs during `next build`, so local builds stay exempt.
    await import("@/server/services/redis/client");
    await import("@/server/services/email/client");
    // A6: Sentry Node init (errors-only). Merged here, not replacing the
    // guards above.
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// A6: forward Server-Component / route-handler / proxy errors to Sentry —
// covers throws that escape outside the action wrapper's own capture path
// (`withAction`, lands in A6·3).
export const onRequestError = Sentry.captureRequestError;
