-- ISOLATED TRIAL PROPOSAL ONLY. NEVER apply the four general proposals alone
-- on the existing trial database. This file must be reviewed with them and
-- applied as ONE transaction after stripping their outer BEGIN/COMMIT.
-- Default disabled, no real IDs or credentials. No auth user creation.
BEGIN;
CREATE TABLE atokore_private.photo_general_trial_scope_v50(
 singleton boolean PRIMARY KEY CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 cleanup_enabled boolean NOT NULL DEFAULT false,
 a uuid,b uuid,c uuid,
 CHECK((a IS NULL AND b IS NULL AND c IS NULL) OR
 (a IS NOT NULL AND b IS NOT NULL AND c IS NOT NULL AND a<>b AND a<>c AND b<>c)),
 CHECK((NOT enabled AND NOT cleanup_enabled) OR a IS NOT NULL),
 CHECK(NOT (enabled AND cleanup_enabled))
);
INSERT INTO atokore_private.photo_general_trial_scope_v50(singleton) VALUES(true);
ALTER TABLE atokore_private.photo_general_trial_scope_v50 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_general_trial_scope_v50 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION atokore_private.photo_trial_actor_v50(p_uid uuid,p_cleanup boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT EXISTS(
  SELECT 1 FROM atokore_private.photo_general_trial_scope_v50 q
  JOIN auth.users u ON u.id=p_uid AND u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE
  WHERE q.singleton AND (CASE WHEN p_cleanup THEN q.cleanup_enabled ELSE q.enabled END)
  AND ((u.id=q.a AND u.email='atokore-gqa-a-20261124@example.invalid')
    OR (u.id=q.b AND u.email='atokore-gqa-b-20261124@example.invalid')
    OR (u.id=q.c AND u.email='atokore-gqa-c-20261124@example.invalid'))
 )
$fn$;
CREATE FUNCTION atokore_private.photo_trial_household_v50(p_h uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT EXISTS(
  SELECT 1 FROM atokore_private.photo_general_trial_scope_v50 q
  JOIN atokore_private.households h ON h.id=p_h
  JOIN auth.users u ON u.id=h.created_by AND u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE
  WHERE q.singleton AND ((h.created_by=q.a AND h.name='ATK-GQA-20261124-A' AND u.email='atokore-gqa-a-20261124@example.invalid')
   OR (h.created_by=q.c AND h.name='ATK-GQA-20261124-C' AND u.email='atokore-gqa-c-20261124@example.invalid'))
 )
$fn$;
REVOKE ALL ON FUNCTION atokore_private.photo_trial_actor_v50(uuid,boolean),atokore_private.photo_trial_household_v50(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Replace the broad trigger before ANY transaction commit. Non-QA inventory
-- writes retain prior behavior. Both old and new rows must match on UPDATE.
DROP TRIGGER photo_ref_guard_v50 ON atokore_private.records;
CREATE TRIGGER photo_trial_ref_insert_v50 BEFORE INSERT ON atokore_private.records
 FOR EACH ROW WHEN (NEW.kind='item' AND NEW.id='qa_general_20261124_item'
 AND atokore_private.photo_trial_household_v50(NEW.household_id))
 EXECUTE FUNCTION atokore_private.photo_ref_guard_v50();
CREATE TRIGGER photo_trial_ref_update_v50 BEFORE UPDATE ON atokore_private.records
 FOR EACH ROW WHEN (OLD.kind='item' AND OLD.id='qa_general_20261124_item'
 AND atokore_private.photo_trial_household_v50(OLD.household_id))
 EXECUTE FUNCTION atokore_private.photo_ref_guard_v50();

-- The service role needs only the scoped SECURITY DEFINER wrappers, not direct table writes.
REVOKE ALL ON atokore_private.photo_ledger_v50,atokore_private.photo_quota_lock_v50,atokore_private.photo_budget_v50 FROM service_role;

-- Move unrestricted bridge functions out of the REST-exposed schema and
-- remove service_role direct EXECUTE. Only scoped wrappers keep public names.
ALTER FUNCTION public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer) SET SCHEMA atokore_private;
ALTER FUNCTION public.hh_photo_cleanup_service_v50(uuid,text,text,boolean) SET SCHEMA atokore_private;
ALTER FUNCTION public.hh_photo_budget_service_v50(uuid,uuid,uuid,text) SET SCHEMA atokore_private;
REVOKE ALL ON FUNCTION atokore_private.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer),
 atokore_private.hh_photo_cleanup_service_v50(uuid,text,text,boolean),
 atokore_private.hh_photo_budget_service_v50(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hh_photo_service_v50(
 p_uid uuid,p_session uuid,p_action text,p_h uuid,p_r text,
 p_file uuid DEFAULT NULL,p_operation uuid DEFAULT NULL,p_expected text DEFAULT NULL,
 p_seq bigint DEFAULT NULL,p_sha text DEFAULT NULL,p_bytes integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 -- A switch-off waits for any currently admitted SQL operation to commit.
 -- Subsequent calls see the new switch state. In-flight HTTP may still finish;
 -- the Edge read path rechecks access after download before returning bytes.
 PERFORM 1 FROM atokore_private.photo_general_trial_scope_v50 WHERE singleton AND enabled FOR SHARE;
 IF NOT FOUND OR p_r IS DISTINCT FROM 'qa_general_20261124_item'
 OR NOT atokore_private.photo_trial_actor_v50(p_uid)
 OR NOT atokore_private.photo_trial_household_v50(p_h)
 THEN RAISE EXCEPTION 'photo_trial_denied' USING ERRCODE='42501'; END IF;
 RETURN atokore_private.hh_photo_service_v50(p_uid,p_session,p_action,p_h,p_r,p_file,p_operation,p_expected,p_seq,p_sha,p_bytes);
END $fn$;
CREATE FUNCTION public.hh_photo_budget_service_v50(p_uid uuid,p_session uuid,p_household uuid,p_operation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM 1 FROM atokore_private.photo_general_trial_scope_v50 WHERE singleton AND enabled FOR SHARE;
 IF NOT FOUND OR NOT atokore_private.photo_trial_actor_v50(p_uid) OR NOT atokore_private.photo_trial_household_v50(p_household)
 THEN RETURN false; END IF;
 RETURN atokore_private.hh_photo_budget_service_v50(p_uid,p_session,p_household,p_operation);
END $fn$;
CREATE FUNCTION public.hh_photo_cleanup_service_v50(p_file uuid,p_action text,p_sha text DEFAULT NULL,p_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_row atokore_private.photo_ledger_v50%ROWTYPE;
BEGIN
 PERFORM 1 FROM atokore_private.photo_general_trial_scope_v50 WHERE singleton AND cleanup_enabled AND NOT enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'photo_trial_cleanup_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_row FROM atokore_private.photo_ledger_v50 WHERE file_id=p_file;
 IF NOT FOUND OR v_row.record_id<>'qa_general_20261124_item'
 OR NOT atokore_private.photo_trial_actor_v50(v_row.actor,true)
 OR NOT atokore_private.photo_trial_household_v50(v_row.household_id)
 THEN RAISE EXCEPTION 'photo_trial_cleanup_denied' USING ERRCODE='42501'; END IF;
 RETURN atokore_private.hh_photo_cleanup_service_v50(p_file,p_action,p_sha,p_confirmed);
END $fn$;
REVOKE ALL ON FUNCTION public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer),
 public.hh_photo_cleanup_service_v50(uuid,text,text,boolean),public.hh_photo_budget_service_v50(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer),
 public.hh_photo_cleanup_service_v50(uuid,text,text,boolean),public.hh_photo_budget_service_v50(uuid,uuid,uuid,text) TO service_role;

-- Trigger WHEN is evaluated under the normal writer role; the private helper
-- needs EXECUTE for that evaluation, not schema USAGE or direct table access.
-- All normal record writes happen through existing SECURITY DEFINER RPCs
-- (owner privileges). No authenticated grant is added.
COMMIT;
-- Before approval: audit trigger scope, config ACL, service_role inherited
-- grants, actual Auth schema, legacy policies, rollback and live probe.
-- Activation requires separately checked exact three Auth UUIDs, matching
-- confirmed emails and approval. Cleanup has a separate mutually exclusive switch.
