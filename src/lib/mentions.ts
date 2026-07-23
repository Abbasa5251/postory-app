/**
 * @-mention markers for post comments (E3). A mention is encoded inline in the
 * comment body as `@[Display Name](memberId)` — a markdown-link-like token. The
 * BODY is the single source of truth: the server derives the mentioned member
 * ids from it (never a separately-trusted array), and the UI resolves the same
 * markers to highlighted names. The display name is client-authored and only
 * ever renders inside that comment's own text (not a trust boundary); the
 * `memberId` is validated against the org's membership before any join row or
 * email is created (§7).
 *
 * Isomorphic (lib/ — imports nothing from server, used by both the composer
 * input and the server action / DAL).
 */

// memberId is a better-auth member.id — OPAQUE text (nanoid-style), NOT a uuid
// (verified: member.id is `text`), so the id group must not assume uuid format;
// `[^()\s]+` accepts any id token. Name is captured non-greedily and `[^\]]`
// forbids a `]` inside the label so adjacent mentions can't merge. Validity of
// the id is enforced downstream by matching it against org membership (§7), not
// by this pattern.
const MENTION_PATTERN = /@\[([^\]]+)\]\(([^()\s]+)\)/g;

/** A parsed mention token and its position in the body. */
export type MentionToken = {
  /** Full matched text, e.g. `@[Jane Doe](uuid)`. */
  raw: string;
  name: string;
  memberId: string;
  index: number;
};

/** All mention tokens in a body, in order (duplicates preserved). */
export function parseMentions(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  for (const m of body.matchAll(MENTION_PATTERN)) {
    tokens.push({
      raw: m[0],
      name: m[1],
      memberId: m[2],
      index: m.index,
    });
  }
  return tokens;
}

/** De-duped member ids mentioned in a body — the authoritative mention set. */
export function parseMentionIds(body: string): string[] {
  return [...new Set(parseMentions(body).map((t) => t.memberId))];
}

/**
 * Build a mention marker for insertion into a comment body. The display name is
 * sanitized of the marker's own delimiters (`[]()` + newlines) so a member whose
 * name contains one (user-controlled `user.name`) can't produce a marker the
 * pattern fails to re-match (which would drop the mention + render a broken
 * marker). Collapsed to spaces; the memberId is authoritative regardless.
 */
export function mentionMarker(name: string, memberId: string): string {
  const safeName = name.replace(/[[\]()\r\n]+/g, " ").trim() || "member";
  return `@[${safeName}](${memberId})`;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert the composer's DISPLAY text (mentions shown as plain `@Name`) into the
 * stored body (mentions as `@[Name](id)` markers), by replacing each inserted
 * mention's `@Name` with its marker. Longest names first so "@Jane Doe" wins
 * over "@Jane"; a produced marker (`@[Name]…`) can't re-match a later `@Name`
 * pass (the bracket differs), so replacement is stable.
 */
export function buildBodyFromDisplay(
  text: string,
  mentions: { name: string; memberId: string }[],
): string {
  let body = text;
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  for (const m of sorted) {
    // `(?!\w)` word-boundary so "@Jane" doesn't corrupt a hand-typed "@Janet";
    // a produced marker (`@[Name]…`) can't re-match a later, shorter `@Name`
    // pass (the bracket differs), so replacement stays stable.
    const pattern = new RegExp(`${escapeRegExp(`@${m.name}`)}(?!\\w)`, "g");
    body = body.replace(pattern, mentionMarker(m.name, m.memberId));
  }
  return body;
}

/**
 * Split a body into plain-text and mention segments for rendering — lets a
 * component highlight `@Name` without re-parsing. Consecutive plain runs are
 * merged; mention segments carry the resolved name + id.
 */
export type BodySegment =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; memberId: string };

/** Render a body to plain text — mention markers collapse to `@Name`. For
 * email quotes / previews where the marker syntax must not leak. */
export function toPlainText(body: string): string {
  return splitBody(body)
    .map((s) => (s.type === "text" ? s.value : `@${s.name}`))
    .join("");
}

export function splitBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const token of parseMentions(body)) {
    if (token.index > cursor) {
      segments.push({ type: "text", value: body.slice(cursor, token.index) });
    }
    segments.push({
      type: "mention",
      name: token.name,
      memberId: token.memberId,
    });
    cursor = token.index + token.raw.length;
  }
  if (cursor < body.length) {
    segments.push({ type: "text", value: body.slice(cursor) });
  }
  return segments;
}
