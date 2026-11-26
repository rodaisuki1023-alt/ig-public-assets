-- DRAFT ONLY (v51, photo A). Not applied to any real project; owner approval required.
-- Requires atokore-photo-reservation-v50.sql, atokore-photo-lifecycle-v50.sql and
-- atokore-photo-service-v50.sql (upload_sha256: the general photo gateway serves only rows that have it).
--
-- 1) Moving one legacy reference (a record photoPath with no attached ledger row) to the managed ledger
--    without ever losing the photo:
--      begin   : backup row + ledger row 'uploading' for the target path + move 'copying' (idempotent;
--                an unfinished move of this product is RESUMED from its state, whatever photoPath shows)
--      (worker): copy the legacy object to atokore-private-photos-v2 through the Storage API and hash
--                both the legacy bytes and the copy read back (the database cannot read object bytes)
--      commit  : one transaction checks the copy exists and both hashes match, then CAS-switches the
--                record AND attaches the ledger row WITH upload_sha256 and its size -> 'switched'.
--                If the product changed meanwhile the move is abandoned; the copy becomes an orphan.
--      (worker): reads the photo the way the general gateway does (authorization, path, size, SHA-256,
--                JPEG, re-check) and compares the bytes with the legacy hash
--      verify  : records that read -> 'verified'. Only now may the legacy object be deleted.
--      (worker): legacy_delete_ok (under lock: verified, nothing references the legacy path any more,
--                no other open move of it) -> Storage API delete
--      finish  : legacy object gone and unreferenced -> 'done'
--    A read that fails leaves the move 'switched' and the legacy object in place (never deleted).
--    Every step can be re-run after a crash or a lost answer. restore (rehearsal) puts the legacy path
--    back from the backup while the legacy object still exists.
-- 2) Orphan collection for a trusted worker, re-checked under the same locks right before any deletion.
-- 3) Read checks: every attached photo of a trial household can be read and hash-checked by the worker;
--    closing the legacy bucket requires one for each (atokore-photo-legacy-close-reads-v51.sql).
-- v51 (Work 6th): every resume of a 'verified' move reads the copy again; the delete is allowed only
-- when that fresh read, the copy's object generation, the legacy object's generation (unchanged since the
-- copy), a backup copy of the legacy bytes (fixed backup bucket) and closed legacy write paths all hold;
-- otherwise it is refused. A failed read takes the move back to 'switched'. A restore works after the
-- legacy object is gone: the backup bytes go to a NEW managed id and must read back through the gateway.
-- Only households on the synthetic trial allowlist; only the three fixed buckets. Service role only.
-- No client grant. No Storage API calls from SQL, no SQL DELETE on storage objects.
BEGIN;
DO $req$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='atokore_private' AND table_name='photo_ledger_v50' AND column_name='upload_sha256')
  THEN RAISE EXCEPTION 'photo_service_v50_required' USING ERRCODE='55000'; END IF;
END $req$;

-- Synthetic trial households only (shared with the assignment / prep drafts; created if absent).
CREATE TABLE IF NOT EXISTS atokore_private.trial_households_v51 (
  household_id uuid PRIMARY KEY REFERENCES atokore_private.households(id),
  label text NOT NULL CHECK (label ~ '^(QA|合成|synthetic)'),
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atokore_private.trial_households_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.trial_households_v51 FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION atokore_private.trial_allowed_v51(p_hh uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT EXISTS (SELECT 1 FROM atokore_private.trial_households_v51 t WHERE t.household_id = p_hh) $$;
REVOKE ALL ON FUNCTION atokore_private.trial_allowed_v51(uuid) FROM PUBLIC, anon, authenticated;

CREATE TABLE atokore_private.photo_legacy_moves_v51 (
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  record_id text NOT NULL,
  legacy_path text NOT NULL CHECK(char_length(legacy_path) BETWEEN 1 AND 180),
  file_id uuid NOT NULL UNIQUE REFERENCES atokore_private.photo_ledger_v50(file_id),
  state text NOT NULL DEFAULT 'copying' CHECK(state IN ('copying','switched','verified','done','abandoned','restored')),
  legacy_sha256 text CHECK(legacy_sha256 ~ '^[0-9a-f]{64}$'),
  copy_sha256 text CHECK(copy_sha256 ~ '^[0-9a-f]{64}$'),
  read_sha256 text CHECK(read_sha256 ~ '^[0-9a-f]{64}$'),
  legacy_gen text,                 -- the legacy object's generation when the move began
  bytes integer CHECK(bytes BETWEEN 1 AND 81920),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(household_id,record_id,legacy_path,file_id)
);
-- One open move per product (resumed by begin).
CREATE UNIQUE INDEX photo_legacy_moves_v51_open ON atokore_private.photo_legacy_moves_v51(household_id,record_id)
  WHERE state IN ('copying','switched','verified');
ALTER TABLE atokore_private.photo_legacy_moves_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_legacy_moves_v51 FROM PUBLIC, anon, authenticated;

-- Taken at begin, before anything changes: what the product pointed at, for restore and audit.
CREATE TABLE atokore_private.photo_legacy_backup_v51 (
  file_id uuid PRIMARY KEY REFERENCES atokore_private.photo_ledger_v50(file_id),
  household_id uuid NOT NULL,
  record_id text NOT NULL,
  photo_path text NOT NULL,
  record_seq bigint NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  -- a copy of the legacy BYTES in the fixed backup bucket, recorded before the legacy object may go
  backup_path text,
  backup_sha256 text CHECK(backup_sha256 ~ '^[0-9a-f]{64}$'),
  backup_bytes integer CHECK(backup_bytes BETWEEN 1 AND 81920),
  backup_gen text
);
ALTER TABLE atokore_private.photo_legacy_backup_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_legacy_backup_v51 FROM PUBLIC, anon, authenticated;

-- A successful gateway-style read of an attached photo (bytes hashed by the worker).
CREATE TABLE atokore_private.photo_read_checks_v51 (
  file_id uuid PRIMARY KEY REFERENCES atokore_private.photo_ledger_v50(file_id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 81920),
  gen text NOT NULL,               -- the object generation that was read (any later write invalidates it)
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atokore_private.photo_read_checks_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_read_checks_v51 FROM PUBLIC, anon, authenticated;

-- The system actor of migration ledger rows (no person; never a member).
CREATE FUNCTION atokore_private.photo_system_actor_v51() RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=''
AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

-- The generation of one Storage object: changes whenever the object is written again at that path
-- (Supabase updates updated_at and the eTag in metadata). NULL when the object does not exist.
CREATE FUNCTION atokore_private.photo_object_gen_v51(p_bucket text,p_name text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT md5(o.id::text||'|'||coalesce(o.updated_at::text,'')||'|'||coalesce(o.metadata->>'eTag','')||'|'||coalesce(o.metadata->>'size',''))
  FROM storage.objects o WHERE o.bucket_id=p_bucket AND o.name=p_name $$;

-- No client role can write the legacy bucket any more (stage 1 applied: no INSERT/UPDATE/ALL policy on
-- storage.objects that names it). Storage has no conditional delete, so without this the object could be
-- written again between the last check and the delete; the delete is refused instead.
CREATE FUNCTION atokore_private.photo_legacy_writes_closed_v51() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT NOT EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='storage' AND p.tablename='objects'
  AND p.cmd IN ('INSERT','UPDATE','ALL')
  AND (p.policyname='atokore_photo_insert' OR coalesce(p.qual,'')||coalesce(p.with_check,'') LIKE '%atokore-product-photos%')) $$;

-- A reference is legacy when no attached ledger row has exactly that path for that record.
CREATE FUNCTION atokore_private.photo_is_legacy_ref_v51(p_h uuid,p_r text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=''
AS $$ SELECT p_path IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l
  WHERE l.household_id=p_h AND l.record_id=p_r AND l.state='attached' AND atokore_private.photo_object_path_v50(l)=p_path) $$;

-- Same lock order as every photo entrypoint: global quota lock, household, item. Trial households only.
CREATE FUNCTION atokore_private.photo_legacy_lock_v51(p_h uuid,p_r text)
RETURNS atokore_private.records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_unavailable' USING ERRCODE='55000'; END IF;
 IF p_h IS NULL OR NOT atokore_private.trial_allowed_v51(p_h) THEN RAISE EXCEPTION 'photo_not_trial_household' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM atokore_private.households WHERE id=p_h FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_rec FROM atokore_private.records WHERE household_id=p_h AND kind='item' AND id=p_r FOR UPDATE;
 RETURN v_rec;
END $fn$;

CREATE FUNCTION atokore_private.photo_legacy_move_json_v51(m atokore_private.photo_legacy_moves_v51,p_reused boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=''
AS $$ SELECT jsonb_build_object('file_id',m.file_id,'state',m.state,'legacy_path',m.legacy_path,
  'target_path',(SELECT atokore_private.photo_object_path_v50(l) FROM atokore_private.photo_ledger_v50 l WHERE l.file_id=m.file_id),
  'legacy_sha',m.legacy_sha256,'reused',p_reused) $$;

CREATE FUNCTION atokore_private.photo_legacy_begin_v51(p_h uuid,p_r text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_old text; v_move atokore_private.photo_legacy_moves_v51%ROWTYPE;
 v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 v_rec:=atokore_private.photo_legacy_lock_v51(p_h,p_r);
 -- Resume an unfinished move of this product from where it stopped (copying / switched / verified).
 -- After a switch the product points at the managed copy, so this must not depend on photoPath.
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51
  WHERE household_id=p_h AND record_id=p_r AND state IN ('copying','switched','verified') FOR UPDATE;
 IF FOUND THEN
  UPDATE atokore_private.photo_legacy_moves_v51 SET attempts=attempts+1,updated_at=clock_timestamp() WHERE file_id=v_move.file_id RETURNING * INTO v_move;
  RETURN atokore_private.photo_legacy_move_json_v51(v_move,true);
 END IF;
 IF v_rec.id IS NULL OR v_rec.deleted THEN RAISE EXCEPTION 'photo_legacy_none' USING ERRCODE='55000'; END IF;
 v_old:=v_rec.fields->>'photoPath';
 IF v_old IS NULL THEN RAISE EXCEPTION 'photo_legacy_none' USING ERRCODE='55000'; END IF;
 IF NOT atokore_private.photo_is_legacy_ref_v51(p_h,p_r,v_old) THEN RAISE EXCEPTION 'photo_not_legacy' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-product-photos' AND name=v_old)
 THEN RAISE EXCEPTION 'photo_legacy_object_missing' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 WHERE household_id=p_h AND record_id=p_r AND state IN ('reserved','uploading','uploaded'))
 THEN RAISE EXCEPTION 'photo_pending_item' USING ERRCODE='55000'; END IF;
 INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_path,expected_seq,state,expires_at)
  VALUES(p_h,p_r,atokore_private.photo_system_actor_v51(),gen_random_uuid(),v_old,v_rec.seq,'uploading',clock_timestamp()+interval '1 day')
  RETURNING * INTO v_row;
 INSERT INTO atokore_private.photo_legacy_backup_v51(file_id,household_id,record_id,photo_path,record_seq) VALUES(v_row.file_id,p_h,p_r,v_old,v_rec.seq);
 INSERT INTO atokore_private.photo_legacy_moves_v51(household_id,record_id,legacy_path,file_id,legacy_gen)
  VALUES(p_h,p_r,v_old,v_row.file_id,atokore_private.photo_object_gen_v51('atokore-product-photos',v_old)) RETURNING * INTO v_move;
 RETURN atokore_private.photo_legacy_move_json_v51(v_move,false);
END $fn$;

CREATE FUNCTION atokore_private.photo_legacy_commit_v51(p_file uuid,p_bytes integer,p_legacy_sha text,p_copy_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE;
 v_rec atokore_private.records%ROWTYPE; v_path text; v_seq bigint;
BEGIN
 -- The copy must be verified by the worker before anything changes.
 IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 81920 OR p_legacy_sha IS NULL OR p_legacy_sha !~ '^[0-9a-f]{64}$'
   OR p_copy_sha IS DISTINCT FROM p_legacy_sha THEN RAISE EXCEPTION 'photo_copy_unverified' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_rec:=atokore_private.photo_legacy_lock_v51(v_move.household_id,v_move.record_id);
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
 v_path:=atokore_private.photo_object_path_v50(v_row);
 -- A retried commit after a lost answer returns the earlier result (same verified hash only).
 IF v_move.state IN ('switched','verified','done') THEN
  IF v_move.copy_sha256 IS DISTINCT FROM p_copy_sha THEN RAISE EXCEPTION 'photo_copy_unverified' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('status','switched','path',v_path,'reused',true);
 END IF;
 IF v_move.state IN ('abandoned','restored') THEN RETURN jsonb_build_object('status',v_move.state,'reused',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
 THEN RAISE EXCEPTION 'photo_storage_unconfirmed' USING ERRCODE='55000'; END IF;
 -- The legacy object itself was written again after the move began: the copy may be of other bytes.
 IF atokore_private.photo_object_gen_v51('atokore-product-photos',v_move.legacy_path) IS DISTINCT FROM v_move.legacy_gen THEN
  UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
  UPDATE atokore_private.photo_legacy_moves_v51 SET state='abandoned',updated_at=clock_timestamp() WHERE file_id=p_file;
  RETURN jsonb_build_object('status','abandoned','why','legacy_changed','reused',false);
 END IF;
 -- The person changed or removed the photo (or the product) while copying: keep their change,
 -- abandon the move; the copy is retired and collected as an orphan. Nothing is overwritten.
 IF v_rec.id IS NULL OR v_rec.deleted OR v_rec.seq IS DISTINCT FROM v_row.expected_seq
   OR v_rec.fields->>'photoPath' IS DISTINCT FROM v_move.legacy_path THEN
  UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
  UPDATE atokore_private.photo_legacy_moves_v51 SET state='abandoned',updated_at=clock_timestamp() WHERE file_id=p_file;
  RETURN jsonb_build_object('status','abandoned','reused',false);
 END IF;
 -- Ledger and reference in one step; upload_sha256 is what the general gateway checks on every read.
 PERFORM set_config('atokore.photo_legacy_switch',p_file::text,true);
 UPDATE atokore_private.photo_ledger_v50 SET state='attached',actual_bytes=p_bytes,upload_sha256=p_copy_sha WHERE file_id=p_file;
 UPDATE atokore_private.records SET fields=jsonb_set(fields,'{photoPath}',to_jsonb(v_path),true),
   seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
  WHERE household_id=v_move.household_id AND kind='item' AND id=v_move.record_id AND seq=v_rec.seq RETURNING seq INTO v_seq;
 PERFORM set_config('atokore.photo_legacy_switch','',true);
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='switched',legacy_sha256=p_legacy_sha,copy_sha256=p_copy_sha,bytes=p_bytes,updated_at=clock_timestamp()
  WHERE file_id=p_file;
 RETURN jsonb_build_object('status','switched','path',v_path,'seq',v_seq,'reused',false);
END $fn$;

-- What a reader sees through the general gateway for one attached photo, with the gateway's own
-- conditions (attached, hash recorded, the live product points at it, household not archived and with
-- an active member). The worker then downloads, hashes and re-asks, exactly as the gateway does.
CREATE FUNCTION atokore_private.photo_read_target_v51(p_file uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 SELECT l.* INTO v_row FROM atokore_private.photo_ledger_v50 l
  JOIN atokore_private.households h ON h.id=l.household_id AND h.archived_at IS NULL
  JOIN atokore_private.records r ON r.household_id=h.id AND r.kind='item' AND r.id=l.record_id AND NOT r.deleted
  WHERE l.file_id=p_file AND l.state='attached' AND l.upload_sha256 IS NOT NULL AND l.actual_bytes IS NOT NULL
   AND r.fields->>'photoPath'=atokore_private.photo_object_path_v50(l)
   AND atokore_private.trial_allowed_v51(l.household_id)
   AND EXISTS(SELECT 1 FROM atokore_private.members m WHERE m.household_id=h.id AND m.left_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('path',atokore_private.photo_object_path_v50(v_row),'sha',v_row.upload_sha256,'bytes',v_row.actual_bytes,
  'gen',atokore_private.photo_object_gen_v51('atokore-private-photos-v2',atokore_private.photo_object_path_v50(v_row)));
END $fn$;

-- Records a successful read (bytes hashed by the worker). For a move it must equal the legacy bytes.
CREATE FUNCTION atokore_private.photo_read_checked_v51(p_file uuid,p_sha text,p_bytes integer,p_gen text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE; v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_t jsonb;
BEGIN
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM atokore_private.photo_legacy_lock_v51(v_row.household_id,v_row.record_id);
 v_t:=atokore_private.photo_read_target_v51(p_file);   -- still readable now, under the lock
 -- The generation the worker saw when it started reading must still be the object's generation now:
 -- a write in between (same path, other bytes) makes the read meaningless.
 IF p_sha IS NULL OR p_sha IS DISTINCT FROM v_t->>'sha' OR p_bytes IS DISTINCT FROM (v_t->>'bytes')::int
   OR p_gen IS NULL OR p_gen IS DISTINCT FROM v_t->>'gen'
 THEN RAISE EXCEPTION 'photo_read_mismatch' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 IF FOUND AND v_move.state IN ('switched','verified') THEN
  IF p_sha IS DISTINCT FROM v_move.legacy_sha256 THEN RAISE EXCEPTION 'photo_read_mismatch' USING ERRCODE='55000'; END IF;
  UPDATE atokore_private.photo_legacy_moves_v51 SET state='verified',read_sha256=p_sha,updated_at=clock_timestamp() WHERE file_id=p_file;
 END IF;
 INSERT INTO atokore_private.photo_read_checks_v51(file_id,sha256,bytes,gen) VALUES(p_file,p_sha,p_bytes,p_gen)
  ON CONFLICT (file_id) DO UPDATE SET sha256=EXCLUDED.sha256,bytes=EXCLUDED.bytes,gen=EXCLUDED.gen,checked_at=now();
 RETURN jsonb_build_object('ok',true,'move',COALESCE((SELECT state FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file),'none'));
END $fn$;

-- A read that failed (502, timeout, other bytes): the earlier check no longer counts, and a verified move
-- goes back to 'switched' (its legacy photo stays until a new read succeeds).
CREATE FUNCTION atokore_private.photo_read_failed_v51(p_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 PERFORM atokore_private.photo_legacy_lock_v51(v_row.household_id,v_row.record_id);
 DELETE FROM atokore_private.photo_read_checks_v51 WHERE file_id=p_file;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='switched',updated_at=clock_timestamp() WHERE file_id=p_file AND state='verified';
 RETURN jsonb_build_object('ok',true);
END $fn$;

-- The worker copied the legacy bytes to the fixed backup bucket (path = the move's target form) and
-- hashed them; they must be the legacy bytes. Recorded with the backup object's generation.
CREATE FUNCTION atokore_private.photo_legacy_backup_recorded_v51(p_file uuid,p_sha text,p_bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_path text;
BEGIN
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM atokore_private.photo_legacy_lock_v51(v_move.household_id,v_move.record_id);
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 v_path:=v_move.household_id::text||'/'||v_move.record_id||'/'||p_file::text||'.jpg';
 IF v_move.state NOT IN ('switched','verified') OR p_sha IS NULL OR p_sha IS DISTINCT FROM v_move.legacy_sha256
   OR p_bytes IS DISTINCT FROM v_move.bytes OR atokore_private.photo_object_gen_v51('atokore-photo-backup-v51',v_path) IS NULL
 THEN RAISE EXCEPTION 'photo_backup_unverified' USING ERRCODE='55000'; END IF;
 UPDATE atokore_private.photo_legacy_backup_v51 SET backup_path=v_path,backup_sha256=p_sha,backup_bytes=p_bytes,
   backup_gen=atokore_private.photo_object_gen_v51('atokore-photo-backup-v51',v_path) WHERE file_id=p_file;
 RETURN jsonb_build_object('ok',true,'path',v_path);
END $fn$;

-- Immediately before the Storage API delete of a legacy object, under the photo locks.
CREATE FUNCTION atokore_private.photo_legacy_delete_ok_v51(p_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_c atokore_private.photo_read_checks_v51%ROWTYPE;
 v_b atokore_private.photo_legacy_backup_v51%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'why','unknown'); END IF;
 PERFORM atokore_private.photo_legacy_lock_v51(v_move.household_id,v_move.record_id);
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file;
 SELECT * INTO v_c FROM atokore_private.photo_read_checks_v51 WHERE file_id=p_file;
 SELECT * INTO v_b FROM atokore_private.photo_legacy_backup_v51 WHERE file_id=p_file;
 IF v_move.state='done' THEN RETURN jsonb_build_object('ok',false,'why','done'); END IF;
 IF v_move.state<>'verified' THEN RETURN jsonb_build_object('ok',false,'why','not_verified'); END IF;
 -- A fresh read (this run), of the copy as it is now.
 IF v_c.file_id IS NULL OR v_c.checked_at<clock_timestamp()-interval '10 minutes' OR v_c.sha256 IS DISTINCT FROM v_row.upload_sha256
   OR v_c.gen IS DISTINCT FROM atokore_private.photo_object_gen_v51('atokore-private-photos-v2',atokore_private.photo_object_path_v50(v_row))
 THEN RETURN jsonb_build_object('ok',false,'why','read_not_fresh'); END IF;
 -- The legacy object is still the one that was copied.
 IF atokore_private.photo_object_gen_v51('atokore-product-photos',v_move.legacy_path) IS DISTINCT FROM v_move.legacy_gen
   AND atokore_private.photo_object_gen_v51('atokore-product-photos',v_move.legacy_path) IS NOT NULL
 THEN RETURN jsonb_build_object('ok',false,'why','legacy_changed'); END IF;
 -- A backup of the legacy bytes exists, unchanged.
 IF v_b.backup_sha256 IS NULL OR v_b.backup_gen IS DISTINCT FROM atokore_private.photo_object_gen_v51('atokore-photo-backup-v51',v_b.backup_path)
 THEN RETURN jsonb_build_object('ok',false,'why','no_backup'); END IF;
 -- No client can write the legacy bucket (no conditional delete in Storage).
 IF NOT atokore_private.photo_legacy_writes_closed_v51() THEN RETURN jsonb_build_object('ok',false,'why','legacy_writes_open'); END IF;
 -- Another product (even a deleted one, which a restore could bring back) still points at it.
 IF EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_move.legacy_path)
 THEN RETURN jsonb_build_object('ok',false,'why','still_referenced'); END IF;
 IF EXISTS(SELECT 1 FROM atokore_private.photo_legacy_moves_v51 WHERE legacy_path=v_move.legacy_path AND file_id<>p_file AND state IN ('copying','switched'))
 THEN RETURN jsonb_build_object('ok',false,'why','other_move_open'); END IF;
 RETURN jsonb_build_object('ok',true,'bucket','atokore-product-photos','path',v_move.legacy_path,'gen',v_move.legacy_gen);
END $fn$;

-- After the worker removed the legacy object through the Storage API.
CREATE FUNCTION atokore_private.photo_legacy_finish_v51(p_file uuid,p_api_confirmed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 IF NOT FOUND OR p_api_confirmed IS DISTINCT FROM true THEN RETURN false; END IF;
 IF v_move.state='done' THEN RETURN true; END IF;
 IF v_move.state<>'verified' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_move.legacy_path)
   OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-product-photos' AND name=v_move.legacy_path)
 THEN RETURN false; END IF;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='done',updated_at=clock_timestamp() WHERE file_id=p_file;
 RETURN true;
END $fn$;

-- Rehearsal / rollback of one move. While the legacy object exists, the product points at it again (from
-- the backup row). After it is gone, a NEW managed id is prepared for the backup bytes (status
-- copy_backup): the worker copies the backup object there and calls restore_commit; the product then points
-- at the new id, which must read back through the gateway like any photo.
CREATE FUNCTION atokore_private.photo_legacy_restore_v51(p_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_b atokore_private.photo_legacy_backup_v51%ROWTYPE;
 v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE; v_new atokore_private.photo_ledger_v50%ROWTYPE; v_seq bigint;
BEGIN
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_rec:=atokore_private.photo_legacy_lock_v51(v_move.household_id,v_move.record_id);
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_file FOR UPDATE;
 SELECT * INTO v_b FROM atokore_private.photo_legacy_backup_v51 WHERE file_id=p_file;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
 IF v_move.state='restored' THEN RETURN jsonb_build_object('status','restored','reused',true); END IF;
 IF v_move.state NOT IN ('switched','verified','done') THEN RAISE EXCEPTION 'photo_restore_not_possible' USING ERRCODE='55000'; END IF;
 IF v_rec.id IS NULL OR v_rec.deleted OR v_rec.fields->>'photoPath' IS DISTINCT FROM atokore_private.photo_object_path_v50(v_row)
 THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-product-photos' AND name=v_b.photo_path) THEN
  PERFORM set_config('atokore.photo_legacy_restore',p_file::text,true);
  UPDATE atokore_private.records SET fields=jsonb_set(fields,'{photoPath}',to_jsonb(v_b.photo_path),true),
    seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
   WHERE household_id=v_move.household_id AND kind='item' AND id=v_move.record_id RETURNING seq INTO v_seq;
  PERFORM set_config('atokore.photo_legacy_restore','',true);
  UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
  DELETE FROM atokore_private.photo_read_checks_v51 WHERE file_id=p_file;
  UPDATE atokore_private.photo_legacy_moves_v51 SET state='restored',updated_at=clock_timestamp() WHERE file_id=p_file;
  RETURN jsonb_build_object('status','restored','path',v_b.photo_path,'seq',v_seq,'reused',false);
 END IF;
 -- The legacy object is gone: restore from the backup bytes to a new id.
 IF v_b.backup_sha256 IS NULL OR v_b.backup_gen IS DISTINCT FROM atokore_private.photo_object_gen_v51('atokore-photo-backup-v51',v_b.backup_path)
 THEN RAISE EXCEPTION 'photo_backup_missing' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_new FROM atokore_private.photo_ledger_v50 WHERE household_id=v_move.household_id AND record_id=v_move.record_id
  AND state='uploading' AND operation_id=p_file;                 -- an earlier, unfinished restore of this move
 IF NOT FOUND THEN
  INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_path,expected_seq,state,expires_at)
   VALUES(v_move.household_id,v_move.record_id,atokore_private.photo_system_actor_v51(),p_file,v_rec.fields->>'photoPath',v_rec.seq,'uploading',clock_timestamp()+interval '1 day')
   RETURNING * INTO v_new;
 END IF;
 RETURN jsonb_build_object('status','copy_backup','file_id',v_new.file_id,'backup_path',v_b.backup_path,'target_path',atokore_private.photo_object_path_v50(v_new));
END $fn$;

CREATE FUNCTION atokore_private.photo_legacy_restore_commit_v51(p_move uuid,p_new uuid,p_bytes integer,p_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_move atokore_private.photo_legacy_moves_v51%ROWTYPE; v_b atokore_private.photo_legacy_backup_v51%ROWTYPE;
 v_rec atokore_private.records%ROWTYPE; v_new atokore_private.photo_ledger_v50%ROWTYPE; v_path text; v_seq bigint;
BEGIN
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_move;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_rec:=atokore_private.photo_legacy_lock_v51(v_move.household_id,v_move.record_id);
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51 WHERE file_id=p_move FOR UPDATE;
 SELECT * INTO v_b FROM atokore_private.photo_legacy_backup_v51 WHERE file_id=p_move;
 SELECT * INTO v_new FROM atokore_private.photo_ledger_v50 WHERE file_id=p_new AND operation_id=p_move AND household_id=v_move.household_id AND record_id=v_move.record_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_path:=atokore_private.photo_object_path_v50(v_new);
 IF v_move.state='restored' AND v_new.state='attached' THEN RETURN jsonb_build_object('status','restored','path',v_path,'reused',true); END IF;
 IF p_sha IS NULL OR p_sha IS DISTINCT FROM v_b.backup_sha256 OR p_bytes IS DISTINCT FROM v_b.backup_bytes
   OR atokore_private.photo_object_gen_v51('atokore-private-photos-v2',v_path) IS NULL
 THEN RAISE EXCEPTION 'photo_copy_unverified' USING ERRCODE='22023'; END IF;
 IF v_rec.seq IS DISTINCT FROM v_new.expected_seq OR v_rec.fields->>'photoPath' IS DISTINCT FROM v_new.expected_path
 THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 -- The ordinary v50 rule: retire the current attached photo, attach the new one, switch in one step.
 UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE household_id=v_move.household_id AND record_id=v_move.record_id
  AND state='attached' AND atokore_private.photo_object_path_v50(photo_ledger_v50)=v_rec.fields->>'photoPath';
 UPDATE atokore_private.photo_ledger_v50 SET state='attached',actual_bytes=p_bytes,upload_sha256=p_sha WHERE file_id=p_new;
 UPDATE atokore_private.records SET fields=jsonb_set(fields,'{photoPath}',to_jsonb(v_path),true),
   seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
  WHERE household_id=v_move.household_id AND kind='item' AND id=v_move.record_id AND seq=v_rec.seq RETURNING seq INTO v_seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 DELETE FROM atokore_private.photo_read_checks_v51 WHERE file_id=p_move;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='restored',updated_at=clock_timestamp() WHERE file_id=p_move;
 RETURN jsonb_build_object('status','restored','path',v_path,'seq',v_seq,'file_id',p_new,'reused',false);
END $fn$;

-- Lets the migration commit and the restore rehearsal (and only they) replace a path. The rest of the
-- v50 guard is unchanged: hh_push and every other writer still cannot create, replace or remove one.
CREATE OR REPLACE FUNCTION atokore_private.photo_ref_guard_v50()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_old text; v_new text:=NEW.fields->>'photoPath';
 v_switch text:=current_setting('atokore.photo_legacy_switch',true); v_restore text:=current_setting('atokore.photo_legacy_restore',true);
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.fields ? 'photoPath' AND NEW.fields->'photoPath' IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 v_old:=OLD.fields->>'photoPath';
 IF COALESCE(v_switch,'')<>'' AND NEW.kind='item' AND NOT NEW.deleted AND NOT OLD.deleted
   AND NEW.household_id=OLD.household_id AND NEW.id=OLD.id AND v_old IS NOT NULL AND v_new IS NOT NULL
   AND EXISTS(SELECT 1 FROM atokore_private.photo_legacy_moves_v51 m JOIN atokore_private.photo_ledger_v50 l ON l.file_id=m.file_id
     WHERE m.file_id::text=v_switch AND m.state='copying' AND m.household_id=NEW.household_id AND m.record_id=NEW.id
       AND m.legacy_path=v_old AND l.state='attached' AND l.upload_sha256 IS NOT NULL AND atokore_private.photo_object_path_v50(l)=v_new)
 THEN RETURN NEW; END IF;
 IF COALESCE(v_restore,'')<>'' AND NEW.kind='item' AND NOT NEW.deleted AND NOT OLD.deleted
   AND NEW.household_id=OLD.household_id AND NEW.id=OLD.id AND v_old IS NOT NULL AND v_new IS NOT NULL
   AND EXISTS(SELECT 1 FROM atokore_private.photo_legacy_moves_v51 m JOIN atokore_private.photo_legacy_backup_v51 b ON b.file_id=m.file_id
     JOIN atokore_private.photo_ledger_v50 l ON l.file_id=m.file_id
     WHERE m.file_id::text=v_restore AND m.state IN ('switched','verified') AND m.household_id=NEW.household_id AND m.record_id=NEW.id
       AND atokore_private.photo_object_path_v50(l)=v_old AND b.photo_path=v_new)
 THEN RETURN NEW; END IF;
 IF OLD.kind='item' AND NOT OLD.deleted AND NEW.deleted AND v_old IS NOT NULL
 AND NEW.household_id=OLD.household_id AND NEW.id=OLD.id AND NEW.kind=OLD.kind
 AND NEW.fields->'photoPath' IS NOT DISTINCT FROM OLD.fields->'photoPath' THEN
  UPDATE atokore_private.photo_ledger_v50 l SET state='retired'
   WHERE l.household_id=OLD.household_id AND l.record_id=OLD.id AND l.state='attached'
    AND atokore_private.photo_object_path_v50(l)=v_old;
  IF FOUND THEN NEW.fields:=NEW.fields-'photoPath'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.fields->'photoPath' IS NOT DISTINCT FROM OLD.fields->'photoPath' THEN RETURN NEW; END IF;
 IF v_new IS NULL AND v_old IS NULL THEN RETURN NEW; END IF;
 IF NEW.kind<>'item' OR NEW.deleted OR OLD.deleted OR NEW.household_id<>OLD.household_id OR NEW.id<>OLD.id OR NEW.kind<>OLD.kind
 THEN RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501'; END IF;
 IF v_old IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE l.household_id=OLD.household_id AND l.record_id=OLD.id
     AND atokore_private.photo_object_path_v50(l)=v_old AND l.state='retired')
 THEN RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501'; END IF;
 IF v_new IS NOT NULL AND (jsonb_typeof(NEW.fields->'photoPath')<>'string' OR NOT EXISTS(
   SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE l.household_id=NEW.household_id AND l.record_id=NEW.id
     AND atokore_private.photo_object_path_v50(l)=v_new AND l.state='attached'))
 THEN RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $fn$;

-- Orphan collection: the list a trusted worker acts on (trial households only). Every action is
-- re-checked by the function that performs it (retire_expired / claim_purge / finish_purge /
-- orphan_object_ok), under the photo locks.
CREATE FUNCTION atokore_private.photo_orphans_v51(p_limit integer DEFAULT 50,p_grace interval DEFAULT interval '1 day')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (
  SELECT * FROM (
   SELECT jsonb_build_object('action','retire_expired','file_id',l.file_id) a,1 o,l.reserved_at t FROM atokore_private.photo_ledger_v50 l
    WHERE l.state IN ('reserved','uploaded') AND l.expires_at<=clock_timestamp() AND atokore_private.trial_allowed_v51(l.household_id)
   UNION ALL
   SELECT jsonb_build_object('action','purge','file_id',l.file_id,'path',atokore_private.photo_object_path_v50(l)),2,l.reserved_at
    FROM atokore_private.photo_ledger_v50 l WHERE l.state IN ('retired','purging') AND atokore_private.trial_allowed_v51(l.household_id)
   UNION ALL
   SELECT jsonb_build_object('action','orphan_object','path',o.name,'gen',atokore_private.photo_object_gen_v51(o.bucket_id,o.name)),3,o.created_at
    FROM storage.objects o WHERE o.bucket_id='atokore-private-photos-v2' AND o.created_at<=clock_timestamp()-p_grace
     AND o.name ~ '^[0-9a-f-]{36}/'
     AND EXISTS(SELECT 1 FROM atokore_private.trial_households_v51 t WHERE t.household_id::text=split_part(o.name,'/',1))
     AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE atokore_private.photo_object_path_v50(l)=o.name)
   UNION ALL
   SELECT jsonb_build_object('action','report_stuck_upload','file_id',l.file_id),4,l.reserved_at FROM atokore_private.photo_ledger_v50 l
    WHERE l.state='uploading' AND l.expires_at<=clock_timestamp()-p_grace AND atokore_private.trial_allowed_v51(l.household_id)
   UNION ALL
   SELECT jsonb_build_object('action','report_stuck_move','file_id',m.file_id,'state',m.state),5,m.updated_at FROM atokore_private.photo_legacy_moves_v51 m
    WHERE m.state IN ('copying','switched','verified') AND m.updated_at<=clock_timestamp()-p_grace
  ) x ORDER BY o,t LIMIT least(greatest(coalesce(p_limit,50),1),200)) s
$fn$;

-- Right before deleting an unledgered object: a trial household's, still unledgered, referenced by no
-- record. The same global lock as reserve/begin, so an upload cannot be reserved in between.
CREATE FUNCTION atokore_private.photo_orphan_object_ok_v51(p_path text,p_gen text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 RETURN p_path IS NOT NULL AND p_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}/[0-9a-f-]{36}\.jpg$'
  AND EXISTS(SELECT 1 FROM atokore_private.trial_households_v51 t WHERE t.household_id::text=split_part(p_path,'/',1))
  -- the very object that was listed (a write since then makes it something else: keep it)
  AND p_gen IS NOT NULL AND atokore_private.photo_object_gen_v51('atokore-private-photos-v2',p_path)=p_gen
  AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE atokore_private.photo_object_path_v50(l)=p_path)
  AND NOT EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=p_path);
END $fn$;

-- Attached photos of trial households that still need a read check (none, or older than the object).
CREATE FUNCTION atokore_private.photo_read_check_due_v51(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT coalesce(jsonb_agg(l.file_id),'[]'::jsonb) FROM (
  SELECT l.file_id FROM atokore_private.photo_ledger_v50 l
   LEFT JOIN atokore_private.photo_read_checks_v51 c ON c.file_id=l.file_id
   WHERE l.state='attached' AND atokore_private.trial_allowed_v51(l.household_id)
     AND (c.file_id IS NULL OR c.sha256 IS DISTINCT FROM l.upload_sha256
          OR c.gen IS DISTINCT FROM atokore_private.photo_object_gen_v51('atokore-private-photos-v2',atokore_private.photo_object_path_v50(l)))
   ORDER BY l.reserved_at LIMIT least(greatest(coalesce(p_limit,50),1),200)) l
$fn$;

REVOKE ALL ON FUNCTION atokore_private.photo_system_actor_v51(),atokore_private.photo_is_legacy_ref_v51(uuid,text,text),
 atokore_private.photo_object_gen_v51(text,text),atokore_private.photo_legacy_writes_closed_v51(),
 atokore_private.photo_legacy_lock_v51(uuid,text),atokore_private.photo_legacy_move_json_v51(atokore_private.photo_legacy_moves_v51,boolean),
 atokore_private.photo_legacy_begin_v51(uuid,text),atokore_private.photo_legacy_commit_v51(uuid,integer,text,text),
 atokore_private.photo_read_target_v51(uuid),atokore_private.photo_read_checked_v51(uuid,text,integer,text),atokore_private.photo_read_failed_v51(uuid),
 atokore_private.photo_legacy_backup_recorded_v51(uuid,text,integer),
 atokore_private.photo_legacy_delete_ok_v51(uuid),atokore_private.photo_legacy_finish_v51(uuid,boolean),
 atokore_private.photo_legacy_restore_v51(uuid),atokore_private.photo_legacy_restore_commit_v51(uuid,uuid,integer,text),
 atokore_private.photo_orphans_v51(integer,interval),
 atokore_private.photo_orphan_object_ok_v51(text,text),atokore_private.photo_read_check_due_v51(integer) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA atokore_private TO service_role;
GRANT EXECUTE ON FUNCTION atokore_private.photo_legacy_begin_v51(uuid,text),atokore_private.photo_legacy_commit_v51(uuid,integer,text,text),
 atokore_private.photo_read_target_v51(uuid),atokore_private.photo_read_checked_v51(uuid,text,integer,text),atokore_private.photo_read_failed_v51(uuid),
 atokore_private.photo_legacy_backup_recorded_v51(uuid,text,integer),
 atokore_private.photo_legacy_delete_ok_v51(uuid),atokore_private.photo_legacy_finish_v51(uuid,boolean),
 atokore_private.photo_legacy_restore_v51(uuid),atokore_private.photo_legacy_restore_commit_v51(uuid,uuid,integer,text),
 atokore_private.photo_orphans_v51(integer,interval),
 atokore_private.photo_orphan_object_ok_v51(text,text),atokore_private.photo_read_check_due_v51(integer),
 atokore_private.photo_retire_expired_v50(uuid),atokore_private.photo_claim_purge_v50(uuid),
 atokore_private.photo_finish_purge_v50(uuid,boolean) TO service_role;
COMMIT;
-- Rollback (after review, before any move ran): drop the functions and tables above and re-run the
-- v50 photo_ref_guard_v50 definition from atokore-photo-lifecycle-v50.sql. After a move ran, first
-- restore each switched/verified move (photo_legacy_restore_v51) while its legacy object exists.
