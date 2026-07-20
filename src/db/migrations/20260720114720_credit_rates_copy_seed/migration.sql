-- Data seed (no schema change): the first credit_rates row so AI copy
-- generation (C2) can price itself. credit_rates is GLOBAL config, not tenant
-- data (PRD §7.2, ADR-012) — model ids + prices live here, never hardcoded in
-- app code. Ships in its own commit BEFORE the credits DAL that reads it (§12).
--
-- 'copy' = 1 credit (PRD §7.2, ≈$0.015 retail, <$0.01 COGS). model_id is an
-- OpenRouter chat-completions model — cheap + capable for captions.
-- Idempotent via the (model_id) unique index, so a re-run is a no-op.
--
-- VERIFY (§3, PRD line 223): re-confirm this model id + price against
-- OpenRouter's live catalog (`/api/v1/models`) at the next phase gate — it is
-- config, so a correction is a compensating INSERT/UPDATE here, not a code change.
INSERT INTO "credit_rates" ("action", "model_id", "credits", "is_active")
VALUES ('copy', 'anthropic/claude-haiku-4.5', 1, true)
ON CONFLICT ("model_id") DO NOTHING;
