import "server-only";
import type { ModerationStatus } from "@/lib/validation/media";

/**
 * Content moderation domain logic (D5) — pure, no I/O, exhaustively unit-tested.
 * The wire calls to the judge model live in `services/openrouter`; the
 * DB writes live in `dal/media` / `dal/generation-jobs`. This module owns only
 * the *decisions*: the deterministic prompt blocklist and the mapping from a
 * judge's raw finding to a `ModerationStatus`, so both are testable + swappable.
 *
 * The gate is HYBRID (founder decision, D5):
 *   1. `screenPrompt` — a deterministic, free, fail-fast FIRST pass on the user's
 *      prompt, run in the server action BEFORE anything is generated or reserved.
 *   2. the OpenRouter judge on the OUTPUT (generated image / caption), mapped to
 *      a verdict by `verdictFromJudge`, run inside the Inngest job.
 * (1) catches obvious terms cheaply; (2) catches the subtle prompts that slip
 * past (1) but still produce unsafe output — defense in depth.
 */

/**
 * The controlled vocabulary the judge maps its findings onto, so audit/log
 * metadata is a stable set rather than free-text. Aligned with the common
 * safety taxonomy (OpenAI/most providers expose the same families).
 */
export const MODERATION_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "violence/graphic",
  "hate",
  "harassment",
  "self-harm",
  "illicit",
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/**
 * Deterministic prompt blocklist — unambiguous, highest-severity safety terms
 * only. A hit blocks the request in the action before any credit is reserved or
 * any model is called. Intentionally conservative (obvious terms) — this is a
 * cheap first gate, not the whole defense: the OUTPUT judge is what catches
 * prompts that are unsafe without containing a listed term.
 *
 * This is NOT the brand's style "banned words" (a copy-tone preference in the
 * voice profile) — those are a stylistic filter applied during generation, not
 * a safety gate. Keep the two concerns separate.
 *
 * Extend as real abuse is observed; because it's a plain list, additions are a
 * one-line change with a matching unit test.
 */
const PROMPT_BLOCKLIST: readonly string[] = [
  // Sexual content involving minors (zero tolerance).
  "child porn",
  "child pornography",
  "childporn",
  "cp",
  "csam",
  "underage sex",
  "underage nude",
  "loli",
  "shota",
  // Non-consensual / extreme sexual violence.
  "rape",
  "non-consensual",
  // Terrorism / mass-casualty how-to.
  "bomb making",
  "how to make a bomb",
  "build a bomb",
  "mass shooting",
];

/** Escape a blocklist term for safe embedding in a word-boundary RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan a user-supplied prompt against the blocklist (case-insensitive, matched
 * on word boundaries so short tokens like "cp" don't fire inside "copy"). Pure.
 * Returns which terms matched so the caller can log them (never surfaced to the
 * end user — see `ModerationError`).
 */
export function screenPrompt(text: string): {
  blocked: boolean;
  matched: string[];
} {
  const matched = PROMPT_BLOCKLIST.filter((term) =>
    new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text),
  );
  return { blocked: matched.length > 0, matched };
}

/**
 * Map a judge's raw finding to a moderation verdict. `flagged` from the judge
 * (or a fail-closed caller — see below) becomes `blocked`; otherwise `passed`.
 * The reason is the joined category list (a stable, non-PII string for the
 * audit metadata). Copy/image output is only ever `passed` or `blocked` here —
 * `pending` is the pre-moderation DB default, never a verdict.
 *
 * Fail-closed: callers that fail to obtain a judgment (the model errored after
 * retry) MUST pass `{ flagged: true, categories: [] }` so un-moderated content
 * is treated as blocked, never silently surfaced.
 */
export function verdictFromJudge(result: {
  flagged: boolean;
  categories: readonly string[];
}): {
  status: Extract<ModerationStatus, "passed" | "blocked">;
  reason: string | null;
} {
  if (!result.flagged) return { status: "passed", reason: null };
  const cats = result.categories.filter(Boolean);
  return {
    status: "blocked",
    reason: cats.length > 0 ? cats.join(", ") : "flagged by moderation",
  };
}
