import "server-only";
import type { ReactNode } from "react";
import { EMAIL_FROM, resend } from "./client";

/**
 * Shared transactional-email primitives (§4 — extracted from auth-emails so the
 * auth flows and the E3 notification emails send the same way instead of each
 * re-implementing it).
 */

export const APP_NAME = "POSTORY";

/**
 * Send one transactional email. THROWS on a provider error so the caller sees
 * the failure — better-auth surfaces it to the user (a verification/reset link
 * that never arrives is worse than a visible error), and the notification job
 * runs each send in its own best-effort `step.run` so one bad address doesn't
 * fail the run.
 */
export async function send(to: string, subject: string, react: ReactNode) {
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    react,
  });
  if (error) {
    throw new Error(`Failed to send "${subject}" email: ${error.message}`);
  }
}
