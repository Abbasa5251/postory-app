import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image ships only the traced node_modules instead of the full
  // dependency tree. Only consumed by the container build; local `next
  // start` is unaffected.
  output: "standalone",
};

// A6 — Sentry bundler plugin (source-map upload + release tagging). The org /
// project / auth-token inputs are BUILD tooling for the plugin, not app runtime
// env, so they are read from process.env here rather than the t3 schema (§15
// governs runtime consumption). Upload is skipped automatically when the auth
// token is absent, so local and CI builds are unaffected.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
