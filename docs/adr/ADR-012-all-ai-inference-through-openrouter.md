---
status: accepted
---

# ADR-012 — All AI inference through OpenRouter

## Context

POSTORY generates social copy (C2) and images (D2, post-launch video) with AI.
PRD D11 locks a single decision: **every AI inference call goes through
OpenRouter** — one `OPENROUTER_API_KEY`, one bill, one-string model swaps.
Referenced throughout AGENTS.md §3 and the PRD, but never written up until now
(C2 is the first task to actually call a model).

## Decision

- **One gateway.** Text uses OpenAI-compatible chat completions via the Vercel
  AI SDK OpenRouter provider (`ai` + `@openrouter/ai-sdk-provider`). Images (D2)
  use OpenRouter's dedicated Image API. Video is post-launch.
- **One module owns the wire format.** `src/server/services/openrouter/` is the
  only place that imports the AI SDK / provider or knows OpenRouter's request
  and response shapes — the direct-provider escape hatch stays open. Callers get
  typed helpers (`streamCaption`), never raw transport.
- **Model ids + prices are config, never code.** They live in the `credit_rates`
  table, read via `dal/credits.ts` (`getActiveRate`). Swapping the caption model
  or repricing is a data change; per-model image capabilities (D2) come from
  OpenRouter's discovery endpoints, never hardcoded.
- **Generation runs in Inngest jobs, never request handlers** (ADR-003). The job
  reserves credits BEFORE the OpenRouter call and settles/refunds after
  (ADR-005). **Streaming transport (C2 founder call):** rather than ADR-003's
  poll default, generated tokens stream to the composer over Inngest realtime —
  the model call still runs inside the durable job; only the progress transport
  differs.
- **Failed generations are unbilled by OpenRouter** → we always refund reserved
  credits on error, which keeps the credit ledger clean.

## Consequences

- Single point of dependency on OpenRouter; mitigated by its own multi-provider
  routing/fallbacks and by keeping the transport isolated to one module.
- Credit refunds are simple because failures cost nothing upstream.
- Adding a model/provider is a `credit_rates` row, not a code change.
