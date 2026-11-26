-- RESTORE DRAFT for unit C, after atokore-buy-assignment-v51.sql was applied again on top of a
-- rollback. Puts the backed-up rows back (only into empty tables) and then drops the backup.
BEGIN;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM atokore_private.buy_assignments) OR EXISTS (SELECT 1 FROM atokore_private.notify_outbox) THEN
    RAISE EXCEPTION 'assignment_tables_not_empty' USING ERRCODE = '55000';
  END IF;
END $g$;
INSERT INTO atokore_private.buy_assignments (household_id, buy_id, assignee, requester, response, rev, updated_at)
  SELECT household_id, buy_id, assignee, requester, response, rev, updated_at FROM atokore_private.rollback_buy_assignments_v51;
-- Reservations are not restored (a sender of that time is gone): claim_token and lease_until stay empty.
-- A notice whose send had started keeps send_started_at, so the next claim reports it in doubt and a
-- non-idempotent provider holds it instead of sending it twice.
INSERT INTO atokore_private.notify_outbox (id, household_id, recipient, kind, created_at, sent_at, dropped_at, drop_reason,
    attempts, send_started_at, next_attempt_at, ambiguous_at, last_result)
  SELECT id, household_id, recipient, kind, created_at, sent_at, dropped_at, drop_reason,
    attempts, send_started_at, next_attempt_at, ambiguous_at, last_result FROM atokore_private.rollback_notify_outbox_v51;
DROP TABLE atokore_private.rollback_buy_assignments_v51, atokore_private.rollback_notify_outbox_v51;
COMMIT;
