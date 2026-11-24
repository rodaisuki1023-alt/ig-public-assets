-- DRAFT ONLY. Conservative application-side traffic budget; no live DB apply.
-- Each admitted request reserves worst-case transfer and counts before doing
-- image decoding or touching Storage. Counters are NOT refunded on errors.
BEGIN;
CREATE TABLE atokore_private.photo_budget_v50(
 scope text NOT NULL CHECK(scope IN ('global_month','user_day','household_day')),
 scope_id uuid NOT NULL,
 period date NOT NULL,
 requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 PRIMARY KEY(scope,scope_id,period)
);
ALTER TABLE atokore_private.photo_budget_v50 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_budget_v50 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.hh_photo_budget_service_v50(p_uid uuid,p_session uuid,p_household uuid,p_operation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_day date; v_month date; v_global constant uuid:='00000000-0000-0000-0000-000000000000';
 v_bytes constant bigint:=262144; -- conservative 256 KiB per admitted request
BEGIN
 IF p_uid IS NULL OR p_session IS NULL OR p_household IS NULL OR p_operation IS NULL
 OR p_operation NOT IN ('read','write','delete') THEN RETURN false; END IF;
 -- Serialize across households, including month boundaries.
 PERFORM 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_uid
   AND (s.not_after IS NULL OR s.not_after>clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM atokore_private.households h JOIN atokore_private.members m ON m.household_id=h.id
   WHERE h.id=p_household AND h.archived_at IS NULL AND m.user_id=p_uid AND m.left_at IS NULL)
 THEN RETURN false; END IF;
 v_day:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 v_month:=date_trunc('month',v_day::timestamp)::date;
 IF EXISTS(SELECT 1 FROM atokore_private.photo_budget_v50 WHERE scope='global_month' AND scope_id=v_global AND period=v_month
   AND (requests>=4000 OR reserved_bytes+v_bytes>1048576000))
 OR EXISTS(SELECT 1 FROM atokore_private.photo_budget_v50 WHERE scope='user_day' AND scope_id=p_uid AND period=v_day AND requests>=80)
 OR EXISTS(SELECT 1 FROM atokore_private.photo_budget_v50 WHERE scope='household_day' AND scope_id=p_household AND period=v_day AND requests>=120)
 THEN RETURN false; END IF;
 INSERT INTO atokore_private.photo_budget_v50(scope,scope_id,period,requests,reserved_bytes)
 VALUES ('global_month',v_global,v_month,1,v_bytes),('user_day',p_uid,v_day,1,v_bytes),('household_day',p_household,v_day,1,v_bytes)
 ON CONFLICT(scope,scope_id,period) DO UPDATE SET requests=photo_budget_v50.requests+1,reserved_bytes=photo_budget_v50.reserved_bytes+v_bytes;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.hh_photo_budget_service_v50(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_budget_service_v50(uuid,uuid,uuid,text) TO service_role;
COMMIT;
-- Bounds: 4000 admitted operations * 256KiB = 1000MiB/month estimated reserve.
-- Does not cap platform invocations before authorization, other project egress,
-- headers, cleanup, retries rejected at the platform or all billing metrics.
-- Actual organization usage and billing period must be checked independently.
