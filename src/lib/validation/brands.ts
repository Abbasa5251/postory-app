import * as z from "zod";
import { normalizeHashtagList, normalizeList } from "@/lib/text";
import { isValidTimeZone } from "@/lib/timezones";

/**
 * Brand input schemas (B1). Canonical zod home per AGENTS.md §4 — compose,
 * never redeclare. `slug` is derived server-side (never user input), so it is
 * absent here. Validated at the server-action boundary (§7/§9).
 */
export const createBrandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Brand name must be at least 2 characters.")
    .max(80, "Brand name must be at most 80 characters."),
  // IANA zone; re-checked server-side because the client is hostile (§7). The
  // brand's timezone drives scheduling (§9, Epic F).
  timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone."),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

/**
 * Update input (B1.2). Same editable fields as create — slug is immutable and
 * derived, so it is never an input — plus the target brand `id`. Composes
 * createBrandSchema so the name/timezone rules stay single-sourced (§4).
 */
export const updateBrandSchema = createBrandSchema.extend({
  id: z.string().min(1, "Brand id is required."),
});

export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

/**
 * Voice profile (B2). All fields optional; feeds AI generation (Epics C/D).
 * Arrays are normalized (trim, drop empties, dedupe; hashtags stripped of '#')
 * before their limits are checked — the same `@/lib/text` helpers the client
 * inputs use, so preview and stored value agree. Stored as JSONB (opaque
 * column); an all-empty profile is collapsed to `null` by updateBrandVoiceSchema.
 */
const boundedList = (opts: {
  maxItems: number;
  maxLen: number;
  label: string;
  hashtags?: boolean;
}) =>
  z
    .array(z.string())
    .transform((items) =>
      opts.hashtags ? normalizeHashtagList(items) : normalizeList(items),
    )
    .pipe(
      z
        .array(
          opts.hashtags
            ? z
                .string()
                .max(opts.maxLen)
                .regex(
                  /^[A-Za-z0-9_]+$/,
                  "Hashtags may contain only letters, numbers, and underscores.",
                )
            : z
                .string()
                .max(
                  opts.maxLen,
                  `Each ${opts.label} entry must be at most ${opts.maxLen} characters.`,
                ),
        )
        .max(opts.maxItems, `At most ${opts.maxItems} ${opts.label}.`),
    );

export const voiceProfileSchema = z.object({
  tone: z
    .string()
    .trim()
    .max(500, "Tone must be at most 500 characters.")
    .optional()
    // Drop a blank tone so an otherwise-populated profile doesn't persist `""`.
    .transform((v) => (v ? v : undefined)),
  bannedWords: boundedList({
    maxItems: 100,
    maxLen: 50,
    label: "banned words",
  }).optional(),
  hashtags: boundedList({
    maxItems: 30,
    maxLen: 100,
    label: "hashtags",
    hashtags: true,
  }).optional(),
  samplePosts: boundedList({
    maxItems: 10,
    maxLen: 2000,
    label: "sample posts",
  }).optional(),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

/** True when a voice profile carries no content (→ stored as `null`). */
export function isEmptyVoiceProfile(
  vp: VoiceProfile | null | undefined,
): boolean {
  if (!vp) return true;
  return (
    !vp.tone?.trim() &&
    !vp.bannedWords?.length &&
    !vp.hashtags?.length &&
    !vp.samplePosts?.length
  );
}

export const updateBrandVoiceSchema = z.object({
  id: z.string().min(1, "Brand id is required."),
  // An all-empty profile collapses to null (AI reads null as "no guidance").
  voiceProfile: voiceProfileSchema
    .nullable()
    .transform((vp) => (isEmptyVoiceProfile(vp) ? null : vp)),
});

export const updateBrandContactSchema = z.object({
  id: z.string().min(1, "Brand id is required."),
  // Optional + clearable: "" → null; a non-empty value must be a valid email.
  clientContactEmail: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Enter a valid email address.").nullable()),
});
