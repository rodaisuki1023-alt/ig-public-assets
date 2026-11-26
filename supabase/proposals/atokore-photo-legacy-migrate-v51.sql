-- DRAFT ONLY (v51, photo A). Not applied to any real project; owner approval required.
-- Requires atokore-photo-reservation-v50.sql and atokore-photo-lifecycle-v50.sql.
--
-- 1) Moving one legacy reference (a record photoPath with no attached ledger row) to the managed
--    ledger, without ever showing a broken photo and without losing it on a failure half-way:
--      begin   : ledger row 'uploading' for the target path + a move row 'copying' (idempotent)
--      (worker): copy the legacy object to atokore-private-photos-v2 through the Storage API,
--                hash both copies (the database cannot read object bytes; the worker attests)
--      commit  : one transaction checks the copy exists and both hashes match, then CAS-switches the
--                record (same seq and same legacy path) and attaches the ledger row. If the record
--                changed meanwhile, the move is abandoned and the copy becomes an orphan to purge.
--      (worker): delete the legacy object through the Storage API
--      finish  : confirms nothing references the legacy path and its object is gone -> 'done'
--    Each step can be re-run after a failure: begin and commit return the earlier result, and no
--    step deletes anything. Existing photos are moved even above the plan limit (never deleted).
-- 2) Orphan collection for a trusted worker: what can be retired, purged or reported, re-checked
--    under the same locks right before any deletion (never a referenced object).
-- No client grant. Service role only. No Storage API calls from SQL, no SQL DELETE on objects.
BEGIN;

CREATE TABLE atokore_private.photo_legacy_moves_v51 (
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  record_id text NOT NULL,
  legacy_path text NOT NULL CHECK(char_length(legacy_path) BETWEEN 1 AND 180),
  file_id uuid NOT NULL UNIQUE REFERENCES atokore_private.photo_ledger_v50(file_id),
  state text NOT NULL DEFAULT 'copying' CHECK(state IN ('copying','switched','done','abandoned')),
  legacy_sha256 text CHECK(legacy_sha256 ~ '^[0-9a-f]{64}$'),
  copy_sha256 text CHECK(copy_sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer CHECK(bytes BETWEEN 1 AND 81920),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(household_id,record_id,legacy_path,file_id)
);
-- One open move per legacy reference.
CREATE UNIQUE INDEX photo_legacy_moves_v51_open ON atokore_private.photo_legacy_moves_v51(household_id,record_id,legacy_path)
  WHERE state IN ('copying','switched');
ALTER TABLE atokore_private.photo_legacy_moves_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_legacy_moves_v51 FROM PUBLIC, anon, authenticated;

-- The system actor of migration ledger rows (no person; never a member).
CREATE FUNCTION atokore_private.photo_system_actor_v51() RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=''
AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

-- A reference is legacy when no attached ledger row has exactly that path for that record.
CREATE FUNCTION atokore_private.photo_is_legacy_ref_v51(p_h uuid,p_r text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=''
AS $$ SELECT p_path IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l
  WHERE l.household_id=p_h AND l.record_id=p_r AND l.state='attached' AND atokore_private.photo_object_path_v50(l)=p_path) $$;

-- Same lock order as every photo entrypoint: global quota lock, household, item.
CREATE FUNCTION atokore_private.photo_legacy_lock_v51(p_h uuid,p_r text)
RETURNS atokore_private.records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_unavailable' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM atokore_private.households WHERE id=p_h FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_rec FROM atokore_private.records WHERE household_id=p_h AND kind='item' AND id=p_r FOR UPDATE;
 RETURN v_rec;
END $fn$;

CREATE FUNCTION atokore_private.photo_legacy_begin_v51(p_h uuid,p_r text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_old text; v_move atokore_private.photo_legacy_moves_v51%ROWTYPE;
 v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 v_rec:=atokore_private.photo_legacy_lock_v51(p_h,p_r);
 IF v_rec.id IS NULL OR v_rec.deleted THEN RAISE EXCEPTION 'photo_legacy_none' USING ERRCODE='55000'; END IF;
 v_old:=v_rec.fields->>'photoPath';
 IF v_old IS NULL THEN RAISE EXCEPTION 'photo_legacy_none' USING ERRCODE='55000'; END IF;
 IF NOT atokore_private.photo_is_legacy_ref_v51(p_h,p_r,v_old) THEN RAISE EXCEPTION 'photo_not_legacy' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_move FROM atokore_private.photo_legacy_moves_v51
  WHERE household_id=p_h AND record_id=p_r AND legacy_path=v_old AND state='copying' FOR UPDATE;
 IF FOUND THEN
  -- A retried begin (worker crashed or timed out): the same target, nothing new is created.
  UPDATE atokore_private.photo_legacy_moves_v51 SET attempts=attempts+1,updated_at=clock_timestamp() WHERE file_id=v_move.file_id;
  SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=v_move.file_id;
  RETURN jsonb_build_object('file_id',v_move.file_id,'legacy_path',v_old,'target_path',atokore_private.photo_object_path_v50(v_row),'reused',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-product-photos' AND name=v_old)
 THEN RAISE EXCEPTION 'photo_legacy_object_missing' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 WHERE household_id=p_h AND record_id=p_r AND state IN ('reserved','uploading','uploaded'))
 THEN RAISE EXCEPTION 'photo_pending_item' USING ERRCODE='55000'; END IF;
 INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_path,expected_seq,state,expires_at)
  VALUES(p_h,p_r,atokore_private.photo_system_actor_v51(),gen_random_uuid(),v_old,v_rec.seq,'uploading',clock_timestamp()+interval '1 day')
  RETURNING * INTO v_row;
 INSERT INTO atokore_private.photo_legacy_moves_v51(household_id,record_id,legacy_path,file_id) VALUES(p_h,p_r,v_old,v_row.file_id);
 RETURN jsonb_build_object('file_id',v_row.file_id,'legacy_path',v_old,'target_path',atokore_private.photo_object_path_v50(v_row),'reused',false);
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
 -- A retried commit after a lost answer returns the earlier result.
 IF v_move.state IN ('switched','done') THEN
  IF v_move.copy_sha256 IS DISTINCT FROM p_copy_sha THEN RAISE EXCEPTION 'photo_copy_unverified' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('status','switched','path',v_path,'reused',true);
 END IF;
 IF v_move.state='abandoned' THEN RETURN jsonb_build_object('status','abandoned','reused',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
 THEN RAISE EXCEPTION 'photo_storage_unconfirmed' USING ERRCODE='55000'; END IF;
 -- The person changed or removed the photo (or the product) while copying: keep their change,
 -- abandon the move; the copy is retired and collected as an orphan. Nothing is overwritten.
 IF v_rec.id IS NULL OR v_rec.deleted OR v_rec.seq IS DISTINCT FROM v_row.expected_seq
   OR v_rec.fields->>'photoPath' IS DISTINCT FROM v_move.legacy_path THEN
  UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
  UPDATE atokore_private.photo_legacy_moves_v51 SET state='abandoned',updated_at=clock_timestamp() WHERE file_id=p_file;
  RETURN jsonb_build_object('status','abandoned','reused',false);
 END IF;
 PERFORM set_config('atokore.photo_legacy_switch',p_file::text,true);
 UPDATE atokore_private.photo_ledger_v50 SET state='attached',actual_bytes=p_bytes WHERE file_id=p_file;
 UPDATE atokore_private.records SET fields=jsonb_set(fields,'{photoPath}',to_jsonb(v_path),true),
   seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
  WHERE household_id=v_move.household_id AND kind='item' AND id=v_move.record_id AND seq=v_rec.seq RETURNING seq INTO v_seq;
 PERFORM set_config('atokore.photo_legacy_switch','',true);
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='switched',legacy_sha256=p_legacy_sha,copy_sha256=p_copy_sha,bytes=p_bytes,updated_at=clock_timestamp()
  WHERE file_id=p_file;
 RETURN jsonb_build_object('status','switched','path',v_path,'seq',v_seq,'reused',false);
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
 IF v_move.state<>'switched' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_move.legacy_path)
   OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-product-photos' AND name=v_move.legacy_path)
 THEN RETURN false; END IF;
 UPDATE atokore_private.photo_legacy_moves_v51 SET state='done',updated_at=clock_timestamp() WHERE file_id=p_file;
 RETURN true;
END $fn$;

-- Lets the migration commit (and only it) replace a legacy path. The rest of the v50 guard is
-- unchanged: hh_push and every other writer still cannot create, replace or remove a photoPath.
CREATE OR REPLACE FUNCTION atokore_private.photo_ref_guard_v50()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_old text; v_new text:=NEW.fields->>'photoPath'; v_switch text:=current_setting('atokore.photo_legacy_switch',true);
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.fields ? 'photoPath' AND NEW.fields->'photoPath' IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 v_old:=OLD.fields->>'photoPath';
 IF COALESCE(v_switch,'')<>'' AND TG_OP='UPDATE' AND NEW.kind='item' AND NOT NEW.deleted AND NOT OLD.deleted
   AND NEW.household_id=OLD.household_id AND NEW.id=OLD.id AND v_old IS NOT NULL AND v_new IS NOT NULL
   AND EXISTS(SELECT 1 FROM atokore_private.photo_legacy_moves_v51 m JOIN atokore_private.photo_ledger_v50 l ON l.file_id=m.file_id
     WHERE m.file_id::text=v_switch AND m.state='copying' AND m.household_id=NEW.household_id AND m.record_id=NEW.id
       AND m.legacy_path=v_old AND l.state='attached' AND atokore_private.photo_object_path_v50(l)=v_new)
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

-- Orphan collection: the list a trusted worker acts on. Every action is re-checked by the function
-- that performs it (retire_expired / claim_purge / finish_purge / orphan_object_ok), under locks.
CREATE FUNCTION atokore_private.photo_orphans_v51(p_limit integer DEFAULT 50,p_grace interval DEFAULT interval '1 day')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (
  SELECT * FROM (
   -- Expired reservations that never started uploading (or finished but were not attached).
   SELECT jsonb_build_object('action','retire_expired','file_id',l.file_id) a,1 o,l.reserved_at t FROM atokore_private.photo_ledger_v50 l
    WHERE l.state IN ('reserved','uploaded') AND l.expires_at<=clock_timestamp()
   UNION ALL
   -- Retired or half-purged objects: purge (claim_purge refuses while anything references them).
   SELECT jsonb_build_object('action','purge','file_id',l.file_id,'path',atokore_private.photo_object_path_v50(l)),2,l.reserved_at
    FROM atokore_private.photo_ledger_v50 l WHERE l.state IN ('retired','purging')
   UNION ALL
   -- Objects in the managed bucket with no ledger row at all, older than the grace period.
   SELECT jsonb_build_object('action','orphan_object','path',o.name),3,coalesce(o.created_at,'epoch')
    FROM storage.objects o WHERE o.bucket_id='atokore-private-photos-v2' AND coalesce(o.created_at,'epoch')<=clock_timestamp()-p_grace
     AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE atokore_private.photo_object_path_v50(l)=o.name)
   UNION ALL
   -- Never inferred from time: a stuck upload or move is reported for a person to look at.
   SELECT jsonb_build_object('action','report_stuck_upload','file_id',l.file_id),4,l.reserved_at FROM atokore_private.photo_ledger_v50 l
    WHERE l.state='uploading' AND l.expires_at<=clock_timestamp()-p_grace
   UNION ALL
   SELECT jsonb_build_object('action','report_stuck_move','file_id',m.file_id),5,m.updated_at FROM atokore_private.photo_legacy_moves_v51 m
    WHERE m.state IN ('copying','switched') AND m.updated_at<=clock_timestamp()-p_grace
  ) x ORDER BY o,t LIMIT least(greatest(coalesce(p_limit,50),1),200)) s
$fn$;

-- Right before deleting an unledgered object: still unledgered and referenced by no record.
CREATE FUNCTION atokore_private.photo_orphan_object_ok_v51(p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 RETURN p_path IS NOT NULL
  AND EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=p_path)
  AND NOT EXISTS(SELECT 1 FROM atokore_private.photo_ledger_v50 l WHERE atokore_private.photo_object_path_v50(l)=p_path)
  AND NOT EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=p_path);
END $fn$;

REVOKE ALL ON FUNCTION atokore_private.photo_system_actor_v51(),atokore_private.photo_is_legacy_ref_v51(uuid,text,text),
 atokore_private.photo_legacy_lock_v51(uuid,text),atokore_private.photo_legacy_begin_v51(uuid,text),
 atokore_private.photo_legacy_commit_v51(uuid,integer,text,text),atokore_private.photo_legacy_finish_v51(uuid,boolean),
 atokore_private.photo_orphans_v51(integer,interval),atokore_private.photo_orphan_object_ok_v51(text) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA atokore_private TO service_role;
GRANT EXECUTE ON FUNCTION atokore_private.photo_legacy_begin_v51(uuid,text),atokore_private.photo_legacy_commit_v51(uuid,integer,text,text),
 atokore_private.photo_legacy_finish_v51(uuid,boolean),atokore_private.photo_orphans_v51(integer,interval),
 atokore_private.photo_orphan_object_ok_v51(text),atokore_private.photo_retire_expired_v50(uuid),
 atokore_private.photo_claim_purge_v50(uuid),atokore_private.photo_finish_purge_v50(uuid,boolean) TO service_role;
COMMIT;
-- Rollback (after review, before any move ran): drop the functions and table above and re-run the
-- v50 photo_ref_guard_v50 definition from atokore-photo-lifecycle-v50.sql.
