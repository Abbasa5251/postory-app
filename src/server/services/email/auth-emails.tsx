import "server-only";
import {
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  ResetPasswordEmail,
} from "@better-auth-ui/react/email";
import { EMAIL_FROM, resend } from "./client";

const APP_NAME = "POSTORY";

async function send(to: string, subject: string, react: React.ReactNode) {
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    react,
  });
  // Throw so better-auth surfaces the failure to the caller instead of
  // silently "sending" a verification/reset link that never arrives.
  if (error) {
    throw new Error(`Failed to send "${subject}" email: ${error.message}`);
  }
}

export async function sendVerificationEmail(input: {
  to: string;
  url: string;
}) {
  await send(
    input.to,
    `Verify your email address`,
    <EmailVerificationEmail
      appName={APP_NAME}
      email={input.to}
      url={input.url}
    />,
  );
}

export async function sendResetPasswordEmail(input: {
  to: string;
  url: string;
}) {
  await send(
    input.to,
    `Reset your password`,
    <ResetPasswordEmail appName={APP_NAME} email={input.to} url={input.url} />,
  );
}

export async function sendOrgInvitationEmail(input: {
  to: string;
  url: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  role: string;
}) {
  await send(
    input.to,
    `You're invited to join ${input.organizationName} on ${APP_NAME}`,
    <OrganizationInvitationEmail
      appName={APP_NAME}
      email={input.to}
      url={input.url}
      organizationName={input.organizationName}
      inviterName={input.inviterName}
      inviterEmail={input.inviterEmail}
      role={input.role}
    />,
  );
}
