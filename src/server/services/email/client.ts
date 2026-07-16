import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env/server";
import { shouldEnforceProductionEnv } from "@/lib/env/runtime";

export const resend = new Resend(env.RESEND_API_KEY);

// Resend sandbox sender — delivers only to the account owner's email until a
// domain is verified. Dev-only fallback; production must set EMAIL_FROM to a
// verified-domain sender (e.g. "Postory <no-reply@postory.in>").
const SANDBOX_FROM = "Postory <onboarding@resend.dev>";

export const EMAIL_FROM = env.EMAIL_FROM ?? SANDBOX_FROM;

// Fires on Vercel builds and at production server boot (via
// src/instrumentation.ts), but not on local/CI `next build`, which runs
// without deploy secrets.
if (shouldEnforceProductionEnv() && EMAIL_FROM === SANDBOX_FROM) {
  throw new Error(
    "EMAIL_FROM must be set to a verified-domain sender in production — the Resend sandbox address only delivers to the account owner.",
  );
}
