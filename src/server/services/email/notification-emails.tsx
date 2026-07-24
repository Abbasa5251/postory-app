import "server-only";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { APP_NAME, send } from "./send";

/**
 * Product notification emails (E3) — post lifecycle (submit/approve/changes) +
 * @mentions. Sent only from the post-notification Inngest job (§16 / ADR-003),
 * never a request handler. Self-contained React Email components (better-auth-ui
 * templates cover only auth flows); the shared `send` helper (§4) does the wire.
 */

// Minimal inline styles — email clients ignore external CSS. Neutral, brandable
// later; kept lean so the template stays a single obvious block.
const styles = {
  body: { backgroundColor: "#f4f4f5", fontFamily: "system-ui, sans-serif" },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    margin: "24px auto",
    maxWidth: "480px",
    padding: "32px",
  },
  heading: { fontSize: "18px", fontWeight: 600, margin: "0 0 12px" },
  text: {
    color: "#3f3f46",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 12px",
  },
  quote: {
    borderLeft: "3px solid #e4e4e7",
    color: "#52525b",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 16px",
    padding: "4px 0 4px 12px",
  },
  button: {
    backgroundColor: "#0d9488",
    borderRadius: "8px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 20px",
    textDecoration: "none",
  },
  footer: { color: "#a1a1aa", fontSize: "12px", margin: "16px 0 0" },
} as const;

function NotificationEmail(props: {
  preview: string;
  heading: string;
  intro: string;
  /** Optional quoted block: the post caption excerpt or a change/mention note. */
  quote?: string | null;
  ctaLabel: string;
  ctaUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{props.heading}</Heading>
          <Text style={styles.text}>{props.intro}</Text>
          {props.quote ? <Text style={styles.quote}>{props.quote}</Text> : null}
          <Section>
            <Button style={styles.button} href={props.ctaUrl}>
              {props.ctaLabel}
            </Button>
          </Section>
          <Hr />
          <Text style={styles.footer}>
            You’re receiving this because you’re a member of a {APP_NAME}{" "}
            workspace.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Shorten a caption/comment for an email quote line. */
function excerpt(text: string, max = 160): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export async function sendPostSubmittedEmail(input: {
  to: string;
  brandName: string;
  submittedByName: string;
  captionExcerpt: string;
  url: string;
}) {
  await send(
    input.to,
    `New post to review — ${input.brandName}`,
    <NotificationEmail
      preview={`${input.submittedByName} submitted a post for ${input.brandName}`}
      heading="A post is ready for your review"
      intro={`${input.submittedByName} submitted a post for ${input.brandName} and it’s waiting for your approval.`}
      quote={input.captionExcerpt ? excerpt(input.captionExcerpt) : null}
      ctaLabel="Review post"
      ctaUrl={input.url}
    />,
  );
}

export async function sendPostApprovedEmail(input: {
  to: string;
  brandName: string;
  approvedByName: string;
  captionExcerpt: string;
  note?: string | null;
  url: string;
}) {
  await send(
    input.to,
    `Your post was approved — ${input.brandName}`,
    <NotificationEmail
      preview={`${input.approvedByName} approved your post for ${input.brandName}`}
      heading="Your post was approved"
      intro={`${input.approvedByName} approved your post for ${input.brandName}.`}
      quote={input.note ? excerpt(input.note) : null}
      ctaLabel="View post"
      ctaUrl={input.url}
    />,
  );
}

export async function sendPostChangesRequestedEmail(input: {
  to: string;
  brandName: string;
  requestedByName: string;
  note: string;
  url: string;
}) {
  await send(
    input.to,
    `Changes requested — ${input.brandName}`,
    <NotificationEmail
      preview={`${input.requestedByName} requested changes on your post`}
      heading="Changes were requested"
      intro={`${input.requestedByName} requested changes on your post for ${input.brandName}:`}
      quote={excerpt(input.note)}
      ctaLabel="Open post"
      ctaUrl={input.url}
    />,
  );
}

export async function sendMentionEmail(input: {
  to: string;
  brandName: string;
  mentionedByName: string;
  commentExcerpt: string;
  url: string;
}) {
  await send(
    input.to,
    `${input.mentionedByName} mentioned you — ${input.brandName}`,
    <NotificationEmail
      preview={`${input.mentionedByName} mentioned you in a comment`}
      heading={`${input.mentionedByName} mentioned you`}
      intro={`${input.mentionedByName} mentioned you in a comment on a ${input.brandName} post:`}
      quote={excerpt(input.commentExcerpt)}
      ctaLabel="View comment"
      ctaUrl={input.url}
    />,
  );
}
