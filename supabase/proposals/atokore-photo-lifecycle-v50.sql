-- DRAFT ONLY: private database-side lifecycle substrate; apply only to isolated test DB.
-- Requires atokore-photo-reservation-v50.sql. No live Storage API calls, public
-- endpoint, client grants, legacy migration or automatic cleanup worker.
BEGIN;
CREATE FUNCTION atokore_private.photo_object_path_v50(p_row atokore_private.photo_ledger_v50)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=''
AS $$ SELECT p_row.household_id::text||'/'||p_row.record_id||'/'||p_row.file_id::text||'.jpg' $$;

-- All mutating photo entrypoints serialize in the same order. Do not call
-- these from an existing transaction holding household/item locks.
CREATE FUNCTION atokore_private.photo_lock_item_v50(p_h uuid,p_r text)
RETURNS atokore_private.records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_rec atokore_private.records%ROWTYPE;
BEGIN
 IF v_uid IS NULL OR p_h IS NULL OR p_r IS NULL THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_unavailable' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM atokore_private.households WHERE id=p_h AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM atokore_private.members WHERE household_id=p_h AND user_id=v_uid AND left_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.sessions WHERE user_id=v_uid AND id::text=auth.jwt()->>'session_id'
   AND (not_after IS NULL OR not_after>clock_timestamp()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_rec FROM atokore_private.records WHERE household_id=p_h AND kind='item' AND id=p_r AND NOT deleted FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 RETURN v_rec;
END $fn$;

-- One-time begin. A timed-out or retried begin cannot authorize a second write.
-- Worker MUST use upsert:false and no new storage requests after begin returns.
CREATE FUNCTION atokore_private.photo_begin_v50(p_h uuid,p_r text,p_file uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 v_rec:=atokore_private.photo_lock_item_v50(p_h,p_r);
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file AND household_id=p_h AND record_id=p_r AND actor=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 IF v_row.state<>'reserved' OR v_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'photo_begin_conflict' USING ERRCODE='55000'; END IF;
 IF v_row.expected_seq IS DISTINCT FROM v_rec.seq OR v_row.expected_path IS DISTINCT FROM v_rec.fields->>'photoPath'
 THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='uploading' WHERE file_id=p_file;
 RETURN atokore_private.photo_object_path_v50(v_row);
END $fn$;

-- Trusted worker calls only after successful, settled Storage upload and JPEG
-- validation. Metadata presence alone does not prove valid JPEG or real bytes.
CREATE FUNCTION atokore_private.photo_finish_v50(p_h uuid,p_r text,p_file uuid,p_bytes integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE; v_path text;
BEGIN
 IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 81920 THEN RAISE EXCEPTION 'photo_invalid_size' USING ERRCODE='22023'; END IF;
 v_rec:=atokore_private.photo_lock_item_v50(p_h,p_r);
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file AND household_id=p_h AND record_id=p_r AND actor=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_path:=atokore_private.photo_object_path_v50(v_row);
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
 THEN RAISE EXCEPTION 'photo_storage_unconfirmed' USING ERRCODE='55000'; END IF;
 IF v_row.state='uploaded' AND v_row.actual_bytes=p_bytes THEN RETURN true; END IF;
 IF v_row.state<>'uploading' THEN RAISE EXCEPTION 'photo_finish_conflict' USING ERRCODE='55000'; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='uploaded',actual_bytes=p_bytes WHERE file_id=p_file;
 RETURN true;
END $fn$;

-- Block arbitrary photoPath creation/replacement/removal from hh_push and other
-- record writers. Only a matching ledger transition in the same locked
-- transaction may change a path; never resurrect a retired/purged object.
CREATE FUNCTION atokore_private.photo_ref_guard_v50()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_old text; v_new text:=NEW.fields->>'photoPath';
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.fields ? 'photoPath' AND NEW.fields->'photoPath' IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'photo_reference_requires_gateway' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 v_old:=OLD.fields->>'photoPath';
 -- Ordinary item deletion already holds the household/record locks. Do not
 -- take the global lock here (lock inversion); retiring changes no quota.
 -- The managed path is detached in the same transaction as the tombstone.
 IF OLD.kind='item' AND NOT OLD.deleted AND NEW.deleted AND v_old IS NOT NULL
 AND NEW.household_id=OLD.household_id AND NEW.id=OLD.id AND NEW.kind=OLD.kind
 AND NEW.fields->'photoPath' IS NOT DISTINCT FROM OLD.fields->'photoPath' THEN
  UPDATE atokore_private.photo_ledger_v50 l SET state='retired'
   WHERE l.household_id=OLD.household_id AND l.record_id=OLD.id AND l.state='attached'
    AND atokore_private.photo_object_path_v50(l)=v_old;
  IF FOUND THEN NEW.fields:=NEW.fields-'photoPath'; END IF;
  -- Unmanaged legacy photo remains held for explicit migration.
  RETURN NEW;
 END IF;
 IF NEW.fields->'photoPath' IS NOT DISTINCT FROM OLD.fields->'photoPath' THEN RETURN NEW; END IF;
 -- Allow absent/null normalization only, but no non-string path.
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
CREATE TRIGGER photo_ref_guard_v50 BEFORE INSERT OR UPDATE ON atokore_private.records
FOR EACH ROW EXECUTE FUNCTION atokore_private.photo_ref_guard_v50();

-- Attach and retire the previous managed object atomically with a seq/path CAS.
-- Any legacy reference without a matching attached ledger row is held for
-- separately approved migration; it must not be overwritten.
CREATE FUNCTION atokore_private.photo_attach_v50(p_h uuid,p_r text,p_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE;
 v_path text; v_old text; v_seq bigint; v_count integer;
BEGIN
 v_rec:=atokore_private.photo_lock_item_v50(p_h,p_r);
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file AND household_id=p_h AND record_id=p_r AND actor=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 v_path:=atokore_private.photo_object_path_v50(v_row);
 v_old:=v_rec.fields->>'photoPath';
 IF v_row.state='attached' AND v_old=v_path THEN RETURN jsonb_build_object('path',v_path,'seq',v_rec.seq,'reused',true); END IF;
 IF v_row.state<>'uploaded' OR v_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'photo_attach_conflict' USING ERRCODE='55000'; END IF;
 IF v_row.expected_seq IS DISTINCT FROM v_rec.seq OR v_row.expected_path IS DISTINCT FROM v_old
 THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
 THEN RAISE EXCEPTION 'photo_storage_unconfirmed' USING ERRCODE='55000'; END IF;
 -- v51 (Work review): a photo for a product WITHOUT one is re-checked against the household plan at
 -- confirm time, so a plan that ended (or a lowered limit) after the reservation refuses it. A
 -- replacement needs no new slot; nothing already attached is removed.
 IF v_old IS NULL AND (SELECT count(DISTINCT l.record_id) FROM atokore_private.photo_ledger_v50 l
      WHERE l.household_id=p_h AND l.state='attached' AND l.record_id<>p_r)
    >= atokore_private.cloud_photo_limit_v51(atokore_private.effective_plan(p_h))
 THEN RAISE EXCEPTION 'photo_plan_limit' USING ERRCODE='55000'; END IF;
 IF v_old IS NOT NULL THEN
   UPDATE atokore_private.photo_ledger_v50 l SET state='retired' WHERE l.household_id=p_h AND l.record_id=p_r
     AND l.state='attached' AND atokore_private.photo_object_path_v50(l)=v_old;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>1 THEN RAISE EXCEPTION 'photo_legacy_hold' USING ERRCODE='55000'; END IF;
 END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='attached' WHERE file_id=p_file;
 UPDATE atokore_private.records SET fields=jsonb_set(fields,'{photoPath}',to_jsonb(v_path),true),
   seq=nextval('atokore_private.change_seq'),updated_by=auth.uid(),updated_at=clock_timestamp()
 WHERE household_id=p_h AND kind='item' AND id=p_r AND seq=v_rec.seq RETURNING seq INTO v_seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('path',v_path,'seq',v_seq,'reused',false);
END $fn$;

-- Detach only the exact currently attached object and current record revision.
-- No storage removal occurs in the user transaction.
CREATE FUNCTION atokore_private.photo_detach_v50(p_h uuid,p_r text,p_file uuid,p_seq bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE; v_seq bigint;
BEGIN
 v_rec:=atokore_private.photo_lock_item_v50(p_h,p_r);
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file AND household_id=p_h AND record_id=p_r FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 IF v_row.state<>'attached' OR v_rec.seq IS DISTINCT FROM p_seq OR v_rec.fields->>'photoPath' IS DISTINCT FROM atokore_private.photo_object_path_v50(v_row)
 THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
 UPDATE atokore_private.records SET fields=fields-'photoPath',seq=nextval('atokore_private.change_seq'),updated_by=auth.uid(),updated_at=clock_timestamp()
   WHERE household_id=p_h AND kind='item' AND id=p_r AND seq=p_seq RETURNING seq INTO v_seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
 RETURN v_seq;
END $fn$;

-- Private worker only. A timed-out upload stays charged and in 'uploading'
-- until the trusted worker can positively establish that no write is in flight.
-- The worker integration is NOT supplied; never infer settlement from expiry.
CREATE FUNCTION atokore_private.photo_retire_expired_v50(p_file uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
 IF NOT FOUND OR v_row.state NOT IN ('reserved','uploaded') OR v_row.expires_at>clock_timestamp() THEN RETURN false; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
 RETURN true;
END $fn$;

-- A purging object can never attach again. Return the exact path to the trusted
-- worker, never a signed URL. No SQL DELETE against storage.objects.
CREATE FUNCTION atokore_private.photo_claim_purge_v50(p_file uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE; v_path text;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
 IF NOT FOUND OR v_row.state NOT IN ('retired','purging') THEN RAISE EXCEPTION 'photo_purge_conflict' USING ERRCODE='55000'; END IF;
 v_path:=atokore_private.photo_object_path_v50(v_row);
 -- Includes tombstones: do not delete an object while ANY record references it.
 IF EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_path)
 THEN RAISE EXCEPTION 'photo_still_referenced' USING ERRCODE='55000'; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='purging' WHERE file_id=p_file;
 RETURN v_path;
END $fn$;

-- Worker attests successful Storage API removal/confirmed absence; independently
-- require metadata absence. No grant to end users, no automated worker enabled.
CREATE FUNCTION atokore_private.photo_finish_purge_v50(p_file uuid,p_api_confirmed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE; v_path text;
BEGIN
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
 IF NOT FOUND OR v_row.state NOT IN ('purging','purged') OR p_api_confirmed IS DISTINCT FROM true THEN RETURN false; END IF;
 v_path:=atokore_private.photo_object_path_v50(v_row);
 IF EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_path)
 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
 THEN RETURN false; END IF;
 UPDATE atokore_private.photo_ledger_v50 SET state='purged' WHERE file_id=p_file;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.photo_object_path_v50(atokore_private.photo_ledger_v50),
 atokore_private.photo_lock_item_v50(uuid,text),atokore_private.photo_begin_v50(uuid,text,uuid),
 atokore_private.photo_finish_v50(uuid,text,uuid,integer),atokore_private.photo_ref_guard_v50(),
 atokore_private.photo_attach_v50(uuid,text,uuid),atokore_private.photo_detach_v50(uuid,text,uuid,bigint),
 atokore_private.photo_retire_expired_v50(uuid),atokore_private.photo_claim_purge_v50(uuid),
 atokore_private.photo_finish_purge_v50(uuid,boolean) FROM PUBLIC,anon,authenticated;
COMMIT;
-- Outstanding: storage worker, true JPEG decoder, read gateway, tombstone/failed
-- upload reconciliation, real PostgreSQL concurrency and new client protocol.
