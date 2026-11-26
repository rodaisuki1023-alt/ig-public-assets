-- ROLLBACK DRAFT for atokore-purchase-undo-window-v51.sql only (unit E). Not applied anywhere.
-- Removes the window guard and the separate RPC; the existing hh_undo_purchases, every receipt (ops) and
-- the purchase history stay exactly as they are (no row is changed or deleted). Keeps the shared trial
-- allowlist (trial_households_v51 / trial_allowed_v51) used by the other units.
-- Restore: apply atokore-purchase-undo-window-v51.sql again (it is re-appliable); there is no data to restore.
BEGIN;
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
DROP FUNCTION IF EXISTS public.hh_undo_purchases_v51(jsonb),
  atokore_private.purchase_undo_guard_v51(),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb),
  atokore_private.purchase_undo_start_v51(timestamptz,jsonb);
COMMIT;
