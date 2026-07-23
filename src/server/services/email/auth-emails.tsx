import "server-only";
import {
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  ResetPasswordEmail,
} from "@better-auth-ui/react/email";
import { APP_NAME, send } from "./send";

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
