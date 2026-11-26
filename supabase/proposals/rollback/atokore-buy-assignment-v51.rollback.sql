-- ROLLBACK DRAFT for atokore-buy-assignment-v51.sql only (unit C). Not applied anywhere.
-- Keeps what other units share: atokore_private.trial_households_v51 and trial_allowed_v51 (used by
-- the prep share, photo and undo-window drafts). Copies every row first, so the unit can be applied
-- again and its data restored (see atokore-buy-assignment-v51.restore.sql). No stock, shopping or
-- photo data is touched. Refuses to run twice over an existing backup (it would be overwritten).
BEGIN;
DO $g$ BEGIN
  IF to_regclass('atokore_private.rollback_buy_assignments_v51') IS NOT NULL THEN
    RAISE EXCEPTION 'assignment_backup_exists' USING ERRCODE = '55000', HINT = 'Restore or archive the earlier backup first.';
  END IF;
END $g$;
CREATE TABLE atokore_private.rollback_buy_assignments_v51 AS SELECT *, now() AS backed_up_at FROM atokore_private.buy_assignments;
CREATE TABLE atokore_private.rollback_notify_outbox_v51 AS SELECT *, now() AS backed_up_at FROM atokore_private.notify_outbox;
ALTER TABLE atokore_private.rollback_buy_assignments_v51 ENABLE ROW LEVEL SECURITY;
ALTER TABLE atokore_private.rollback_notify_outbox_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.rollback_buy_assignments_v51, atokore_private.rollback_notify_outbox_v51 FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS buy_assign_member_left_v51 ON atokore_private.members;
DROP FUNCTION IF EXISTS public.hh_buy_assign(text, uuid, integer), public.hh_buy_respond(text, text, integer), public.hh_buy_assignments(),
  atokore_private.buy_assign_member_left_v51(), atokore_private.notify_due_v51(integer),
  atokore_private.notify_claim_v51(integer, integer), atokore_private.notify_authorize_v51(text, uuid),
  atokore_private.notify_complete_v51(text, uuid, text), atokore_private.notify_stale_why_v51(atokore_private.notify_outbox),
  atokore_private.notify_mark_sent_v51(text),   -- earlier draft only (IF EXISTS)
  atokore_private.active_member_v51(uuid, uuid);
DROP TABLE atokore_private.buy_assignments, atokore_private.notify_outbox;
COMMIT;
