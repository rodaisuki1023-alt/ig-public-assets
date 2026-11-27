-- ROLLBACK DRAFT for atokore-purchase-undo-window-v51.sql only (unit E). Not applied anywhere.
-- Removes the undo window: the guard on the receipt, the separate undo RPC and the dedicated purchase
-- command. The existing hh_undo_purchases / hh_push, every receipt (ops) and the purchase history stay
-- exactly as they are (no row is changed or deleted). Keeps the shared trial allowlist.
-- Before running it: turn the shared undo OFF in the app (purchaseUndoWindowV51:false). While the window is
-- rolled back the old hh_undo_purchases has no 10-minute limit for trial households.
-- Work 9th: the forecast part is KEPT and keeps working: purchase_undone_strip_v51 (ownership by op id),
-- purchase_readopt_v51 (exact op only) and purchase_forecast_undo_v51 (an undo by ANY RPC removes exactly that
-- op's entries). So an undone purchase can never come back, a re-purchase is its own op, and re-applying the
-- window changes none of it.
-- Work 8th: the estimate's history is KEPT (the earlier rollback dropped it, and a stale phone could then
-- write an undone entry back): the undone entries, the quarantine, the purchase receipts and the
-- write-back guard with its re-adoption stay. Removing those is a separate step, only once no row is left
-- in purchase_undone_entries_v51 / purchase_forecast_quarantine_v51 (see the forecast section below).
-- Restore: apply atokore-purchase-undo-window-v51.sql again (it is re-appliable); nothing to restore.
BEGIN;
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
DROP FUNCTION IF EXISTS public.hh_undo_purchases_v51(jsonb), public.hh_push_v51(jsonb,jsonb,text), public.hh_clock_ticket_v51(),
  public.hh_purchase_receipts_status_v51(),
  atokore_private.purchase_undo_guard_v51(),
  atokore_private.purchase_undo_refusal_v51(uuid,uuid,jsonb,uuid),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb,uuid),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb),
  atokore_private.purchase_undo_start_v51(timestamptz,jsonb);
DROP TABLE IF EXISTS atokore_private.purchase_clock_tickets_v51;
COMMIT;
-- Forecast section (separate approval; refuses while any history row exists):
--   DO $$ BEGIN IF EXISTS (SELECT 1 FROM atokore_private.purchase_undone_entries_v51) OR EXISTS (SELECT 1 FROM atokore_private.purchase_forecast_quarantine_v51)
--     THEN RAISE EXCEPTION 'forecast_history_present'; END IF; END $$;
--   DROP TRIGGER purchase_undone_strip_v51 ON atokore_private.records; DROP TRIGGER purchase_readopt_v51 ON atokore_private.ops;
--   DROP TRIGGER purchase_forecast_undo_v51 ON atokore_private.ops;
