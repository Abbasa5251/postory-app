-- Data seed (no schema change): the credit_rates rows for AI image generation
-- (Epic D, D1/D2). credit_rates is GLOBAL config, not tenant data (PRD §7.2,
-- ADR-012) — model ids + prices live here, never hardcoded in app code. Ships
-- in its own commit BEFORE the image pipeline that reads it (§12). Mirrors the
-- 'copy' seed (20260720114720).
--
-- Credits are fixed by PRD §7.2 (retail ≈ $0.015/credit):
--   image_standard = 3 credits  (~$0.03–0.04 COGS)
--   image_premium  = 12 credits (~$0.15 COGS)
-- getActiveRate(action) picks the cheapest active model when several rows share
-- an action, so more standard/premium models can be added later as compensating
-- INSERTs without a code change.
--
-- Model ids verified against OpenRouter's live Image API catalog on 2026-07-22
-- (`/api/v1/images/models` + `/{id}/endpoints`):
--   standard = bytedance-seed/seedream-4.5  ($0.04/image; 1:1,4:5,9:16,16:9 all
--              supported) — matches PRD §2's standard band.
--   premium  = google/gemini-3-pro-image (Nano Banana Pro class; 1:1,4:5,9:16,
--              16:9 all supported) — PRD §2's premium (~$0.08–0.15) band.
-- Both models generate one image per request in this pipeline (fan-out), so
-- per-image failures isolate + refund cleanly.
--
-- Idempotent via the (model_id) unique index — a re-run is a no-op.
--
-- VERIFY (§3, PRD line 223 / §7.3 checkbox): re-confirm these model ids + prices
-- against OpenRouter's live catalog at the next phase gate — config, so a
-- correction is a compensating INSERT/UPDATE here, not a code change.
INSERT INTO "credit_rates" ("action", "model_id", "credits", "is_active")
VALUES
  ('image_standard', 'bytedance-seed/seedream-4.5', 3, true),
  ('image_premium', 'google/gemini-3-pro-image', 12, true)
ON CONFLICT ("model_id") DO NOTHING;
