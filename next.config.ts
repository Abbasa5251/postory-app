import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
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
