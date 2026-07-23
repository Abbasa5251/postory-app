# OpenRouter service

The only module that speaks the OpenRouter / AI SDK wire format (ADR-012 — ALL
AI inference goes through OpenRouter). Text captions (C2/C3) and images (D2).
Preserves a direct-provider escape hatch: nothing outside this module knows the
transport.

## Wire layer (AGENTS.md §3)

Verified against the installed packages:

- `ai@7.0.31`
  - `streamText({ model, system, prompt, temperature, maxOutputTokens, abortSignal })`
    → `{ textStream: AsyncIterable<string>, text: Promise<string> }`.
  - `generateImage({ model, prompt, aspectRatio, n, abortSignal })` — `aspectRatio`
    is a `"{w}:{h}"` string → `{ images: GeneratedFile[] }`, each `GeneratedFile`
    = `{ base64, uint8Array, mediaType }`. (Exported directly in v7 — not `experimental_`.)
- `@openrouter/ai-sdk-provider@3.0.0` — `createOpenRouter({ apiKey, appName, appUrl })`
  → provider; `provider.chat(modelId)` is the language model, `provider.imageModel(modelId)`
  is the image model. `apiKey` from `env.OPENROUTER_API_KEY` (lazy — unset only
  fails at first real call, like the Zernio client / getRedis).

Text is OpenAI-compatible chat completions; images go through the AI SDK image
API over the same provider. Model ids come from the `credit_rates` config table
via `dal/credits.ts` (`getActiveRate`) — never hardcoded here (ADR-012).

## Images (D2)

`generateImages({ modelId, prompt, aspectRatio, n })` returns
`{ bytes, mediaType, providerId }[]` — decoded image bytes the Inngest job stores
in R2 (`storage.putObject`) and records as a `media_assets` row
(`source='generated'`); `providerId` is OpenRouter's `x-request-id` response
header, persisted on the generation job for billing cross-reference. OpenRouter's
image models cap `n` per request at 1, so the job **fans out one call per
variant** (`n: 1`), keeping per-image failures isolated and refundable (failed
generations are unbilled by OpenRouter → refund the reservation, ADR-012 / §8). The prompt is
assembled in `domain/image-prompt.ts` (pure); the tier→model+price mapping lives
in `credit_rates` (`image_standard` / `image_premium`).

## Batch = one call

`streamCaption` makes a single streamed call that returns the whole variant
batch (PRD §7.2 — a copy batch is 1 credit). The prompt (built in
`domain/copy-prompt.ts`) instructs the model to separate variants with a `===`
sentinel line; `parseVariants` splits the final text. The Inngest job forwards
`textStream` deltas to the realtime channel and reserves/settles credits around
the call (§8, ADR-005).

## VERIFY at the next phase gate (§3, PRD line 223)

- The seeded `copy` model id + price (`credit_rates`) against OpenRouter's live
  catalog (`/api/v1/models`). It's config — a correction is a compensating
  ledger/rate row, not a code change.
- The seeded `image_standard` / `image_premium` model ids + per-image prices
  against the Image API catalog (`/api/v1/images/models` + `/{id}/endpoints`).
  Verified 2026-07-22: `bytedance-seed/seedream-4.5` ($0.04/image) and
  `google/gemini-3-pro-image` (Nano Banana Pro), both supporting the four aspect
  presets (1:1, 4:5, 9:16, 16:9). Config — a correction is a compensating row.
