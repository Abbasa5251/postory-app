-- D5 moderation config (schema + data). Two coupled changes for the content
-- moderation gate (PRD Epic D / D5), shipped in their own migration BEFORE the
-- logic that reads them (§12):
--   1. Widen credit_rates.action to allow 'moderation' (a 0-credit GATE action —
--      it never moves the credit_ledger; it only carries the judge model id so
--      that id stays in config, ADR-012, never hardcoded in app code).
--   2. Seed the moderation judge row: a cheap, fast, vision-capable chat model
--      used to classify generated images (vision) AND captions (text). One row
--      serves both; getActiveRate("moderation") returns it.
--
-- Model id verified against OpenRouter's live model catalog on 2026-07-23
-- (`/api/v1/models`): google/gemini-3.1-flash-lite-20260507 accepts image input
-- (multimodal) and is among the cheapest such models (~$0.25/M prompt tokens).
-- credits = 0 (moderation is a gate we absorb, never billed to the org).
--
-- VERIFY (§3): re-confirm the model id + that it still accepts image input at
-- the next phase gate — this is config, so a swap is a compensating INSERT/UPDATE
-- here (a cheaper/better model, or splitting image vs text judges), never code.
--
-- Idempotent: the (model_id) unique index makes the INSERT a no-op on re-run.
-- (Note: model_id is unique across ALL actions, so the moderation model must be
-- a DISTINCT id from the copy/image models — it is.)
ALTER TABLE "credit_rates" DROP CONSTRAINT "credit_rates_action_check", ADD CONSTRAINT "credit_rates_action_check" CHECK ("action" IN ('copy', 'image_standard', 'image_premium', 'video_standard', 'video_premium', 'moderation'));--> statement-breakpoint
INSERT INTO "credit_rates" ("action", "model_id", "credits", "is_active")
VALUES
  ('moderation', 'google/gemini-3.1-flash-lite-20260507', 0, true)
ON CONFLICT ("model_id") DO NOTHING;
