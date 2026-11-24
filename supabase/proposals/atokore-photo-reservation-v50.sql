-- DRAFT ONLY. Reservation substrate for a future general-purpose photo gateway.
-- Do not apply to a real project or expose RPCs until the full lifecycle,
-- client integration, storage deletion and concurrency gates are proven.
-- No legacy photo policy, existing record or public RPC is modified.
BEGIN;
CREATE TABLE atokore_private.photo_quota_lock_v50 (
  singleton boolean PRIMARY KEY CHECK(singleton)
);
INSERT INTO atokore_private.photo_quota_lock_v50(singleton) VALUES(true);
ALTER TABLE atokore_private.photo_quota_lock_v50 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_quota_lock_v50 FROM PUBLIC, anon, authenticated;

CREATE TABLE atokore_private.photo_ledger_v50 (
  file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  record_id text NOT NULL CHECK(record_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  actor uuid NOT NULL,
  operation_id uuid NOT NULL,
  expected_path text,
  state text NOT NULL DEFAULT 'reserved'
    CHECK(state IN ('reserved','uploading','uploaded','attached','retired','purging','purged')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  actual_bytes integer CHECK(actual_bytes BETWEEN 1 AND 81920),
  UNIQUE(household_id,operation_id),
  CHECK(state NOT IN ('uploaded','attached') OR actual_bytes IS NOT NULL)
);
ALTER TABLE atokore_private.photo_ledger_v50 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_ledger_v50 FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX photo_ledger_v50_one_pending ON atokore_private.photo_ledger_v50(household_id,record_id)
  WHERE state IN ('reserved','uploading','uploaded');
CREATE UNIQUE INDEX photo_ledger_v50_one_attached ON atokore_private.photo_ledger_v50(household_id,record_id)
  WHERE state='attached';
CREATE INDEX photo_ledger_v50_quota ON atokore_private.photo_ledger_v50(household_id,state);

-- Reservation is the only implemented stage. Future privileged workers MUST
-- take the same global lock, household lock, then item lock in that order.
-- Charge the entire 80 KiB to each non-purged row (including expired, failed,
-- retired and purging objects) until storage deletion is positively confirmed.
-- No user-facing endpoint and no Storage writes in this proposal.
CREATE FUNCTION atokore_private.photo_reserve_v50(
  p_household uuid, p_record text, p_operation uuid, p_expected text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_current text;
  v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_household IS NULL OR p_operation IS NULL OR p_record IS NULL
    OR p_record !~ '^[A-Za-z0-9_-]{8,64}$'
    OR char_length(COALESCE(p_expected,''))>180
    OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=v_uid
        AND s.id::text=auth.jwt()->>'session_id' AND (s.not_after IS NULL OR s.not_after>clock_timestamp()))
  THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;

  -- Serialize quota checks globally, including simultaneous households.
  PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo_quota_unavailable' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM atokore_private.households WHERE id=p_household AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM atokore_private.members WHERE household_id=p_household AND user_id=v_uid AND left_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
  -- Recheck session after any lock wait; use actual clock, not transaction start.
  IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=v_uid
      AND s.id::text=auth.jwt()->>'session_id' AND (s.not_after IS NULL OR s.not_after>clock_timestamp()))
  THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;

  SELECT r.fields->>'photoPath' INTO v_current
    FROM atokore_private.records r WHERE r.household_id=p_household AND r.kind='item'
    AND r.id=p_record AND NOT r.deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_row FROM atokore_private.photo_ledger_v50
    WHERE household_id=p_household AND operation_id=p_operation;
  IF FOUND THEN
    IF v_row.actor<>v_uid OR v_row.record_id<>p_record OR v_row.expected_path IS DISTINCT FROM p_expected
    THEN RAISE EXCEPTION 'photo_operation_conflict' USING ERRCODE='23505'; END IF;
    -- Return same reservation identity without issuing new space or renewing a lease.
    RETURN jsonb_build_object('file_id',v_row.file_id,'state',v_row.state,'expires_at',v_row.expires_at,
      'reused',true,'eligible',v_row.state='reserved' AND v_row.expires_at>clock_timestamp()
         AND v_current IS NOT DISTINCT FROM p_expected);
  END IF;
  IF v_current IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 WHERE household_id=p_household
      AND record_id=p_record AND state IN ('reserved','uploading','uploaded'))
  THEN RAISE EXCEPTION 'photo_pending_item' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM atokore_private.photo_ledger_v50 WHERE household_id=p_household
      AND state IN ('reserved','uploading','uploaded'))>=3
  THEN RAISE EXCEPTION 'photo_pending_limit' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM atokore_private.photo_ledger_v50 WHERE household_id=p_household AND state<>'purged')>=50
    OR (SELECT count(*) FROM atokore_private.photo_ledger_v50 WHERE state<>'purged')>=1280
  THEN RAISE EXCEPTION 'photo_quota' USING ERRCODE='55000'; END IF;
  INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_path,expires_at)
    VALUES(p_household,p_record,v_uid,p_operation,p_expected,clock_timestamp()+interval '5 minutes')
    RETURNING * INTO v_row;
  RETURN jsonb_build_object('file_id',v_row.file_id,'state',v_row.state,'expires_at',v_row.expires_at,'reused',false,'eligible',true);
END;
$fn$;
REVOKE ALL ON FUNCTION atokore_private.photo_reserve_v50(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
COMMIT;
-- No grant even to client authenticated or anon. No public wrapper yet.
-- Next: begin-upload/finish, attach CAS, retire and purge workers, prevent
-- arbitrary hh_push photoPath injection, verify real PostgreSQL locking.
