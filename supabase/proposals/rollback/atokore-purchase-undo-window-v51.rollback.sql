-- ROLLBACK DRAFT for atokore-purchase-undo-window-v51.sql only (unit E). Not applied anywhere.
-- Removes the window guard and the separate RPC; the existing hh_undo_purchases, every receipt (ops) and
-- the purchase history stay exactly as they are (no row is changed or deleted). Keeps the shared trial
-- allowlist (trial_households_v51 / trial_allowed_v51) used by the other units.
-- Restore: apply atokore-purchase-undo-window-v51.sql again (it is re-appliable); there is no data to restore.
BEGIN;
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
DROP TRIGGER IF EXISTS purchase_undone_strip_v51 ON atokore_private.records;
DROP FUNCTION IF EXISTS public.hh_undo_purchases_v51(jsonb), public.hh_clock_ticket_v51(),
  atokore_private.purchase_undo_guard_v51(),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb,uuid),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb),
  atokore_private.purchase_undo_start_v51(timestamptz,jsonb);
-- Clock tickets only open undo windows; the undone-entry list only protects the estimate while the unit
-- is applied. Without the unit both mean nothing (receipts, products and history stay as they are).
DROP FUNCTION IF EXISTS atokore_private.purchase_undone_strip_v51();
DROP TABLE IF EXISTS atokore_private.purchase_clock_tickets_v51, atokore_private.purchase_undone_entries_v51;
COMMIT;
