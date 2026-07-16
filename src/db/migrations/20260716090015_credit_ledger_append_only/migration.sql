-- Custom migration (hand-written; triggers can't be expressed in drizzle
-- schema). ADR-005 / AGENTS.md §8: credit_ledger is APPEND-ONLY — corrections
-- are compensating entries, never UPDATE/DELETE/TRUNCATE. Enforced here at
-- the PG layer on top of the DAL contract.
CREATE FUNCTION credit_ledger_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only (ADR-005): write a compensating entry';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_block_mutation();
--> statement-breakpoint
-- pg_trigger_depth() = 0 exempts FK-cascade deletes: org deletion is full
-- tenant teardown (org_id → organization is ON DELETE CASCADE) and must
-- keep working; only direct DELETEs are rejected.
CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON "credit_ledger"
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION credit_ledger_block_mutation();
--> statement-breakpoint
-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level
-- guard. No exemption: nothing FK-references credit_ledger and org teardown
-- cascades via DELETE, so no legitimate path truncates this table.
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON "credit_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_ledger_block_mutation();
