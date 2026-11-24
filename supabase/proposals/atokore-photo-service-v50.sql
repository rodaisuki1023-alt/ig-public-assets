-- DRAFT ONLY. Service-only bridge for verified Edge identity. NOT APPLIED.
-- Must follow reservation and lifecycle proposals in an isolated DB.
BEGIN;
ALTER TABLE atokore_private.photo_ledger_v50 ADD COLUMN upload_sha256 text
 CHECK(upload_sha256 IS NULL OR (length(upload_sha256)=64 AND upload_sha256 ~ '^[0-9a-f]{64}$'));
CREATE FUNCTION public.hh_photo_service_v50(
 p_uid uuid,p_session uuid,p_action text,p_h uuid,p_r text,
 p_file uuid DEFAULT NULL,p_operation uuid DEFAULT NULL,p_expected text DEFAULT NULL,
 p_seq bigint DEFAULT NULL,p_sha text DEFAULT NULL,p_bytes integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rec atokore_private.records%ROWTYPE; v_row atokore_private.photo_ledger_v50%ROWTYPE;
 v_result jsonb; v_path text;
BEGIN
 -- The only caller allowed is the trusted service role. The Edge adapter derives
 -- these identifiers from verified JWT + Auth getUser, never from the body.
 IF p_uid IS NULL OR p_session IS NULL OR p_h IS NULL OR p_r IS NULL
 OR length(p_r) NOT BETWEEN 8 AND 64 OR p_r !~ '^[A-Za-z0-9_-]+$'
 OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session AND user_id=p_uid
 AND (not_after IS NULL OR not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'session_id',p_session)::text,true);
 IF p_action='read' THEN
  -- Fresh statement per call, and repeated after actual file read by the Edge.
  SELECT l.* INTO v_row FROM atokore_private.photo_ledger_v50 l
   JOIN atokore_private.households h ON h.id=l.household_id AND h.archived_at IS NULL
   JOIN atokore_private.members m ON m.household_id=h.id AND m.user_id=p_uid AND m.left_at IS NULL
   JOIN atokore_private.records r ON r.household_id=h.id AND r.kind='item' AND r.id=l.record_id AND NOT r.deleted
   WHERE l.household_id=p_h AND l.record_id=p_r AND l.file_id=p_file AND l.state='attached'
   AND l.upload_sha256 IS NOT NULL AND r.fields->>'photoPath'=atokore_private.photo_object_path_v50(l)
   AND EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session AND user_id=p_uid AND (not_after IS NULL OR not_after>clock_timestamp()));
  IF NOT FOUND THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('path',atokore_private.photo_object_path_v50(v_row),'sha',v_row.upload_sha256,'bytes',v_row.actual_bytes);
 END IF;
 v_rec:=atokore_private.photo_lock_item_v50(p_h,p_r);
 IF p_action='reserve' THEN
  IF p_operation IS NULL OR p_seq IS NULL OR p_sha IS NULL OR length(p_sha)<>64 OR p_sha !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'photo_invalid_request' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE household_id=p_h AND operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
   IF v_row.actor<>p_uid OR v_row.record_id<>p_r OR v_row.expected_seq IS DISTINCT FROM p_seq
   OR v_row.expected_path IS DISTINCT FROM p_expected OR v_row.upload_sha256 IS DISTINCT FROM p_sha
   THEN RAISE EXCEPTION 'photo_operation_conflict' USING ERRCODE='23505'; END IF;
  ELSE
   IF v_rec.seq<>p_seq OR v_rec.fields->>'photoPath' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'photo_stale_reference' USING ERRCODE='40001'; END IF;
   v_result:=atokore_private.photo_reserve_v50(p_h,p_r,p_operation,p_expected);
   UPDATE atokore_private.photo_ledger_v50 SET upload_sha256=p_sha WHERE file_id=(v_result->>'file_id')::uuid RETURNING * INTO v_row;
  END IF;
  v_path:=atokore_private.photo_object_path_v50(v_row);
  RETURN jsonb_build_object('file_id',v_row.file_id,'path',v_path,'state',v_row.state,'sha',v_row.upload_sha256,
    'current',v_row.state='attached' AND v_rec.fields->>'photoPath'=v_path,
    'seq',v_rec.seq);
 END IF;
 IF p_action='detach' THEN
  RETURN jsonb_build_object('seq',atokore_private.photo_detach_v50(p_h,p_r,p_file,p_seq));
 END IF;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file AND household_id=p_h AND record_id=p_r AND actor=p_uid FOR UPDATE;
 IF NOT FOUND OR v_row.upload_sha256 IS NULL OR p_sha IS DISTINCT FROM v_row.upload_sha256
 THEN RAISE EXCEPTION 'photo_denied' USING ERRCODE='42501'; END IF;
 IF p_action='begin' THEN
  RETURN jsonb_build_object('path',atokore_private.photo_begin_v50(p_h,p_r,p_file));
 ELSIF p_action='finish' THEN
  RETURN jsonb_build_object('ok',atokore_private.photo_finish_v50(p_h,p_r,p_file,p_bytes));
 ELSIF p_action='attach' THEN
  RETURN atokore_private.photo_attach_v50(p_h,p_r,p_file);
 END IF;
 RAISE EXCEPTION 'photo_invalid_request' USING ERRCODE='22023';
END $fn$;
REVOKE ALL ON FUNCTION public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer) TO service_role;

-- Worker has no client route. Unknown uploads remain charged. A positive,
-- hash-matched read of a completed object after expiry can retire an uploading
-- row; an absent object / timeout is NOT evidence that no write remains in flight.
CREATE FUNCTION public.hh_photo_cleanup_service_v50(p_file uuid,p_action text,p_sha text DEFAULT NULL,p_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE; v_path text;
BEGIN
 IF p_action='retire_expired' THEN RETURN jsonb_build_object('ok',atokore_private.photo_retire_expired_v50(p_file)); END IF;
 IF p_action='claim_purge' THEN RETURN jsonb_build_object('path',atokore_private.photo_claim_purge_v50(p_file)); END IF;
 IF p_action='finish_purge' THEN RETURN jsonb_build_object('ok',atokore_private.photo_finish_purge_v50(p_file,p_confirmed)); END IF;
 IF p_action='settled_upload' THEN
  PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
  SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file FOR UPDATE;
  IF NOT FOUND OR v_row.state<>'uploading' OR v_row.expires_at>clock_timestamp() OR p_confirmed IS DISTINCT FROM true
  OR p_sha IS NULL OR p_sha IS DISTINCT FROM v_row.upload_sha256 THEN RETURN jsonb_build_object('ok',false); END IF;
  v_path:=atokore_private.photo_object_path_v50(v_row);
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='atokore-private-photos-v2' AND name=v_path)
  OR EXISTS(SELECT 1 FROM atokore_private.records WHERE fields->>'photoPath'=v_path) THEN RETURN jsonb_build_object('ok',false); END IF;
  UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE file_id=p_file;
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION 'photo_invalid_request' USING ERRCODE='22023';
END $fn$;
REVOKE ALL ON FUNCTION public.hh_photo_cleanup_service_v50(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_cleanup_service_v50(uuid,text,text,boolean) TO service_role;
COMMIT;
