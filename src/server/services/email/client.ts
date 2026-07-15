import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env/server";

export const resend = new Resend(env.RESEND_API_KEY);

// Resend sandbox sender — delivers only to the account owner's email until a
// domain is verified. Replace with e.g. "POSTORY <no-reply@postory.app>" once
// a sending domain is verified in Resend.
export const EMAIL_FROM = "POSTORY <onboarding@resend.dev>";
