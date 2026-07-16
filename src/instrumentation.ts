export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Importing these runs their production env guards (ADR-011): a prod
    // server missing UPSTASH_* / EMAIL_FROM fails at boot instead of on the
    // first request that pulls in the auth/email module graph. register()
    // never runs during `next build`, so local builds stay exempt.
    await import("@/server/services/redis/client");
    await import("@/server/services/email/client");
  }
}
