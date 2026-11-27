-- PROPOSAL ONLY (v51, purchase-undo window). Not a migration; not applied to any real project.
--
-- What changed from the first draft (Work review): the existing public.hh_undo_purchases is NOT
-- replaced (that would change every household at once). A separate RPC, hh_undo_purchases_v51, adds the
-- window and answers only for households on the synthetic trial allowlist; the app calls it only when
-- its config flag purchaseUndoWindowV51 is true (default false) and falls back to the existing RPC when
-- the server answers exactly not_enabled. Rollback: see below — the existing RPC, the receipts (ops) and
-- the purchase history are untouched.
--
-- The window (decided by the server, from times it can trust):
--   start = the EARLIER of
--     * when the purchase reached the server (ops.at, the server's own clock), and
--     * when the phone says it was bought (op body "ts"), clamped to [ops.at - 30 days, ops.at + 60 s].
--   The phone's time can only make the window SHORTER, never longer: a phone whose clock is wrong
--   forward gains nothing (clamped to ops.at), and a purchase made offline and synced 40 minutes later
--   is already past its window (the delay does not restart it).
--   Undo is allowed while now() - start < 10 minutes; at 10:00 and later it is refused with
--   purchase_undo_expired and NOTHING changes (the whole batch is checked before any update).
--   An undo pressed at 9:59 that reaches the server at 10:00 or later is refused; the app shows
--   "10分を過ぎたため、取り消せません" and the stock stays as bought (the phone also refuses at 10:00).
--   A purchase already undone answers its retry (undone 0) even after the window, as before.
-- v51 (Work 6th review):
--   * The window now holds on EVERY entry for trial households: a guard on the receipt itself
--     (atokore_private.ops, the moment "_undo_done" is set) refuses an expired undo, so the existing
--     RPC hh_undo_purchases can no longer bypass it. Non-trial households are unchanged.
--   * The phone's time is not trusted to open a window: a receipt without a whole-number "ts", or with a
--     "ts" more than 60 s ahead of the server's receive time, is refused (purchase_undo_time_invalid).
--     A phone time earlier than the receive time still only shortens the window (offline purchases).
--   * Re-appliable (CREATE OR REPLACE / IF EXISTS); rollback:
--     rollback/atokore-purchase-undo-window-v51.rollback.sql (keeps the shared trial allowlist).
-- Verified only in isolated PGlite and a local PostgreSQL (tests/atokore-purchase-undo-window-v51.test.cjs,
-- tests/atokore-undo-window-guard-v51.test.cjs, tests/household/undo-window-postgres.cjs).
BEGIN;
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

-- Work 8th (E, candidate spec change; shared undo stays OFF in the app until the owner approves):
-- the time a purchase really happened on a phone cannot be proven, and a cached or after-the-fact clock
-- ticket proved nothing either (Work: an offline purchase was undone after reconnecting; one ticket served
-- two purchases). The server now proves only ONE thing: when IT accepted the purchase.
--   * Undo rights exist only for a purchase accepted through the dedicated purchase command
--     hh_push_v51(p_ops, p_receipt_ops): a complete_buy listed in p_receipt_ops and FIRST applied in that
--     call gets a receipt fixing, in the same transaction, the op id, the actor, the household, the
--     product, the shopping row, the quantity and the server's receive time.
--   * The ordinary sync (hh_push), the old RPC, a resend (duplicate), the offline outbox (the app never
--     lists an op created offline) and anything else get no receipt: undo -> purchase_undo_unprovable.
--   * The window is 10 minutes from the server's receive time. A modified client could still send an old
--     purchase through the command: then the window counts from when the server received it — the
--     guarantee is "10 minutes after the server confirmed it", not "10 minutes after the real purchase".
-- Buying, stock, sync, the local single undo, manual quantity correction and history are unchanged.
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
DROP FUNCTION IF EXISTS atokore_private.purchase_undo_guard_v51(),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb,uuid),
  atokore_private.purchase_undo_start_v51(timestamptz,jsonb),
  public.hh_clock_ticket_v51();
DROP TABLE IF EXISTS atokore_private.purchase_clock_tickets_v51;
CREATE TABLE IF NOT EXISTS atokore_private.purchase_receipts_v51 (
  op_id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  actor uuid NOT NULL,
  item_id text NOT NULL,
  buy_id text NOT NULL,
  qty numeric NOT NULL CHECK (qty >= 0),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE atokore_private.purchase_receipts_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.purchase_receipts_v51 FROM PUBLIC, anon, authenticated;
-- The dedicated purchase command. Applies the batch exactly like hh_push (same rules, same idempotency)
-- and, in the same transaction, gives a receipt to each listed complete_buy that this call applied.
-- Outside the trial it answers exactly {status:'not_enabled'} and applies NOTHING (the app then uses hh_push).
-- Work 9th (E input, owner-approved spec: undo only within 10 minutes of the FIRST server acceptance by the
-- dedicated purchase command). The dedicated input is checked strictly BEFORE anything is applied; one bad
-- element refuses the whole call (purchase, stock, shopping list, receipts and forecast unchanged):
--   p_ops: an array of 1..200 objects; p_receipt_ops: an array of 1..100 JSON strings, each a UUID, no
--   duplicates; each listed id must be a complete_buy op OF THIS CALL (op_id, item and buy as strings); an id
--   already known for another person or household is refused. NULL, an empty list, other types, malformed
--   UUIDs, unlisted ops and mixtures are all refused. Receipts are given only on a POSITIVE match (= ANY ...
--   IS TRUE): SQL three-valued logic can never let a NULL through. A resend of an accepted purchase gets no new
--   receipt (its time is unchanged). The ordinary sync (hh_push) is a different path and grants nothing.
CREATE OR REPLACE FUNCTION public.hh_purchase_receipts_status_v51() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.my_household(u);
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('status',CASE WHEN atokore_private.trial_allowed_v51(h) THEN 'ready' ELSE 'not_enabled' END);
END $fn$;
REVOKE ALL ON FUNCTION public.hh_purchase_receipts_status_v51() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_purchase_receipts_status_v51() TO authenticated;
CREATE OR REPLACE FUNCTION public.hh_push_v51(p_ops jsonb, p_receipt_ops jsonb, p_device text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
  r jsonb; x jsonb; v_want uuid[]:='{}'; v_id uuid; v_txt text; o atokore_private.ops%ROWTYPE; v_given jsonb:='[]'::jsonb;
  UUID_RE constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(h) THEN RETURN jsonb_build_object('status','not_enabled'); END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) NOT BETWEEN 1 AND 200
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_ops) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object')
     OR jsonb_typeof(p_receipt_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipt_ops) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_receipt_ops) LOOP
    IF jsonb_typeof(x) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023'; END IF;
    v_txt:=lower(x #>> '{}');
    IF (v_txt ~ UUID_RE) IS NOT TRUE THEN RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023'; END IF;
    v_id:=v_txt::uuid;
    IF (v_id = ANY(v_want)) IS TRUE THEN RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023'; END IF;
    -- A complete_buy of THIS call, with this id, a shopping row and a product.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_ops) e
              WHERE jsonb_typeof(e->'op_id')='string' AND lower(e->>'op_id')=v_txt AND e->>'type'='complete_buy'
                AND jsonb_typeof(e->'buy')='string' AND jsonb_typeof(e->'item')='string') IS NOT TRUE THEN
      RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023';
    END IF;
    -- Known already for someone else (another person or household): refused.
    IF EXISTS(SELECT 1 FROM atokore_private.ops k WHERE k.op_id=v_id AND (k.household_id<>h OR k.actor<>u)) THEN
      RAISE EXCEPTION 'purchase_receipt_input_invalid' USING ERRCODE='22023';
    END IF;
    v_want:=v_want||v_id;
  END LOOP;
  r:=public.hh_push(p_ops,p_device);
  FOR x IN SELECT * FROM jsonb_array_elements(r->'results') LOOP
    CONTINUE WHEN (x->>'status' = 'applied') IS NOT TRUE;
    v_txt:=lower(x->>'op_id');
    CONTINUE WHEN (v_txt ~ UUID_RE) IS NOT TRUE;
    v_id:=v_txt::uuid;
    CONTINUE WHEN (v_id = ANY(v_want)) IS NOT TRUE;                       -- positive match only
    SELECT * INTO o FROM atokore_private.ops WHERE household_id=h AND op_id=v_id;
    CONTINUE WHEN NOT FOUND OR (o.type='complete_buy' AND o.result='applied' AND o.actor=u) IS NOT TRUE;
    INSERT INTO atokore_private.purchase_receipts_v51(op_id,household_id,actor,item_id,buy_id,qty)
     VALUES(v_id,h,u,o.body->>'item',o.body->>'buy',GREATEST(coalesce((o.body->>'_itemAfter')::numeric-(o.body->>'_itemBefore')::numeric,0),0))
     ON CONFLICT (op_id) DO NOTHING;
    v_given:=v_given||to_jsonb(v_id::text);
  END LOOP;
  RETURN r||jsonb_build_object('status','ready','receipts',v_given);
END $fn$;
REVOKE ALL ON FUNCTION public.hh_push_v51(jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_push_v51(jsonb,jsonb,text) TO authenticated;


-- NULL while this purchase may still be undone; otherwise why not. Only trial households have a window.
-- The receipt must belong to this op, household and actor and name the same product and shopping row.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_refusal_v51(p_hh uuid,p_op uuid,p_body jsonb,p_actor uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_at timestamptz;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(p_hh) THEN RETURN NULL; END IF;
  SELECT rc.received_at INTO v_at FROM atokore_private.purchase_receipts_v51 rc
   WHERE rc.op_id=p_op AND rc.household_id=p_hh AND rc.actor=p_actor
     AND rc.item_id IS NOT DISTINCT FROM p_body->>'item' AND rc.buy_id IS NOT DISTINCT FROM p_body->>'buy';
  IF v_at IS NULL THEN RETURN 'purchase_undo_unprovable'; END IF;
  IF clock_timestamp()-v_at>=interval '10 minutes' THEN RETURN 'purchase_undo_expired'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_refusal_v51(uuid,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;


-- ---- The forecast, owned by the purchase's immutable op id (Work 9th) ---------------------------------
-- An estimate entry of a shared purchase carries the op id of ITS complete_buy ("o"), fixed when the phone
-- made the purchase, and its key is 'op:'||o (one field per purchase, so a new purchase of the same shopping
-- row never shares a field with an older one). The server accepts an entry only when that op exists in this
-- household, is a complete_buy of this product that restocked it (result applied), and is not undone.
-- Ownership never changes: a write that would give a field another op is refused. Anything else is held in
-- the quarantine (never deleted, never counted): unknown owner (old clients, no "o"), owner not yet applied
-- (re-adopted ONLY when that exact op is applied), mismatch, or undone. Nothing is ever re-attributed by the
-- shopping row. These triggers belong to the forecast, not to the undo window: a rollback of the window keeps
-- them (rollback/atokore-purchase-undo-window-v51.rollback.sql), so an undone purchase stays undone in the
-- forecast whichever RPC undid it, also while the window is rolled back and after it is applied again.
CREATE TABLE IF NOT EXISTS atokore_private.purchase_undone_entries_v51 (
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  item_id text NOT NULL,
  field text NOT NULL CHECK (field ~ '^tp[0-9a-z]{1,13}$'),
  k text NOT NULL CHECK (char_length(k) BETWEEN 1 AND 80),
  op_id uuid NOT NULL,
  undone_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (household_id, item_id, field, k)
);
ALTER TABLE atokore_private.purchase_undone_entries_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.purchase_undone_entries_v51 FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS atokore_private.purchase_forecast_quarantine_v51 (
  id bigserial PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  item_id text NOT NULL,
  field text NOT NULL,
  value jsonb NOT NULL,
  reason text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE atokore_private.purchase_forecast_quarantine_v51 ADD COLUMN IF NOT EXISTS op_id uuid;
ALTER TABLE atokore_private.purchase_forecast_quarantine_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.purchase_forecast_quarantine_v51 FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_readopt_v51 ON atokore_private.ops;
DROP TRIGGER IF EXISTS purchase_undone_strip_v51 ON atokore_private.records;
DROP FUNCTION IF EXISTS atokore_private.purchase_entry_owner_v51(uuid,text,jsonb,timestamptz);
-- NULL when the entry may stand; otherwise why it is held.
CREATE OR REPLACE FUNCTION atokore_private.purchase_entry_check_v51(p_hh uuid,p_item text,p_field text,v jsonb,p_old jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE o atokore_private.ops%ROWTYPE; v_o text:=lower(v->>'o');
BEGIN
  IF (v_o ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE THEN RETURN 'owner_unknown'; END IF;
  IF (v->>'k' = 'op:'||v_o) IS NOT TRUE THEN RETURN 'owner_mismatch'; END IF;
  IF jsonb_typeof(p_old)='object' AND p_old ? 'o' AND (lower(p_old->>'o') = v_o) IS NOT TRUE THEN RETURN 'owner_immutable'; END IF;
  SELECT * INTO o FROM atokore_private.ops WHERE household_id=p_hh AND op_id=v_o::uuid;
  IF NOT FOUND THEN RETURN 'owner_pending'; END IF;
  IF (o.type='complete_buy' AND o.body->>'item'=p_item) IS NOT TRUE THEN RETURN 'owner_mismatch'; END IF;
  IF (o.body->>'_undo_done'='true') IS TRUE THEN RETURN 'undone'; END IF;
  IF o.result='pending' THEN RETURN 'owner_pending'; END IF;
  IF (o.result='applied') IS NOT TRUE THEN RETURN 'owner_not_restocked'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_entry_check_v51(uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION atokore_private.purchase_undone_strip_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE f text; v jsonb; v_old jsonb; why text;
BEGIN
  IF NEW.kind<>'item' OR NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  FOR f,v IN SELECT * FROM jsonb_each(coalesce(NEW.fields,'{}'::jsonb)) LOOP
    CONTINUE WHEN f !~ '^tp[0-9a-z]{1,13}$' OR jsonb_typeof(v) IS DISTINCT FROM 'object';
    v_old:=CASE WHEN TG_OP='UPDATE' THEN OLD.fields->f ELSE NULL END;
    CONTINUE WHEN v_old IS NOT DISTINCT FROM v;                             -- unchanged: nothing to decide
    why:=atokore_private.purchase_entry_check_v51(NEW.household_id,NEW.id,f,v,v_old);
    CONTINUE WHEN why IS NULL;
    NEW.fields:=CASE WHEN v_old IS NULL THEN NEW.fields-f ELSE jsonb_set(NEW.fields,ARRAY[f],v_old) END;
    INSERT INTO atokore_private.purchase_forecast_quarantine_v51(household_id,item_id,field,value,reason,op_id)
     VALUES(NEW.household_id,NEW.id,f,v,why,CASE WHEN lower(v->>'o') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v->>'o')::uuid END);
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undone_strip_v51() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_undone_strip_v51 BEFORE INSERT OR UPDATE OF fields ON atokore_private.records
FOR EACH ROW EXECUTE FUNCTION atokore_private.purchase_undone_strip_v51();
-- The exact op was applied after its entry arrived: that held entry (and only that one) is put back.
CREATE OR REPLACE FUNCTION atokore_private.purchase_readopt_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q record;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NULL; END IF;
  FOR q IN SELECT * FROM atokore_private.purchase_forecast_quarantine_v51 z
            WHERE z.household_id=NEW.household_id AND z.op_id=NEW.op_id AND z.reason='owner_pending' ORDER BY z.id LOOP
    UPDATE atokore_private.records SET fields=fields||jsonb_build_object(q.field,q.value),seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
     WHERE household_id=q.household_id AND kind='item' AND id=q.item_id AND NOT deleted AND NOT (fields ? q.field);
    DELETE FROM atokore_private.purchase_forecast_quarantine_v51 WHERE id=q.id;
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_readopt_v51() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_readopt_v51 AFTER UPDATE OF result ON atokore_private.ops
FOR EACH ROW WHEN (NEW.type='complete_buy' AND NEW.result='applied' AND OLD.result IS DISTINCT FROM 'applied')
EXECUTE FUNCTION atokore_private.purchase_readopt_v51();
-- An undo (whichever RPC, window applied or rolled back) removes exactly the entries of that op, in the same
-- transaction as the stock and the shopping row. If the estimate had counted it, the product asks to be checked.
CREATE OR REPLACE FUNCTION atokore_private.purchase_forecast_undo_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE f text; v jsonb; v_fields jsonb; v_changed boolean:=false; v_check boolean:=false;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NULL; END IF;
  SELECT r.fields INTO v_fields FROM atokore_private.records r
   WHERE r.household_id=NEW.household_id AND r.kind='item' AND r.id=OLD.body->>'item' FOR UPDATE;
  IF v_fields IS NULL THEN RETURN NULL; END IF;
  FOR f,v IN SELECT * FROM jsonb_each(v_fields) LOOP
    CONTINUE WHEN f !~ '^tp[0-9a-z]{1,13}$' OR jsonb_typeof(v) IS DISTINCT FROM 'object';
    CONTINUE WHEN (lower(v->>'o') = OLD.op_id::text) IS NOT TRUE;
    v_fields:=v_fields-f; v_changed:=true;
    INSERT INTO atokore_private.purchase_undone_entries_v51(household_id,item_id,field,k,op_id)
     VALUES(NEW.household_id,OLD.body->>'item',f,coalesce(v->>'k','op:'||OLD.op_id),OLD.op_id) ON CONFLICT DO NOTHING;
    IF jsonb_typeof(v_fields->'track'->'seen')='array' AND (v_fields->'track'->'seen') ? (v->>'k') THEN v_check:=true; END IF;
  END LOOP;
  IF v_check AND jsonb_typeof(v_fields->'track')='object' THEN v_fields:=jsonb_set(v_fields,'{track,check}','"purchase_undo"'::jsonb,true); END IF;
  IF v_changed THEN
    UPDATE atokore_private.records SET fields=v_fields,seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
     WHERE household_id=NEW.household_id AND kind='item' AND id=OLD.body->>'item';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_forecast_undo_v51() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_forecast_undo_v51 ON atokore_private.ops;
CREATE TRIGGER purchase_forecast_undo_v51 AFTER UPDATE OF body ON atokore_private.ops
FOR EACH ROW WHEN (OLD.type='complete_buy' AND NEW.body->>'_undo_done'='true' AND OLD.body->>'_undo_done' IS DISTINCT FROM 'true')
EXECUTE FUNCTION atokore_private.purchase_forecast_undo_v51();

-- The undo window itself (part of E; dropped by its rollback): an expired or unprovable undo is refused and
-- the whole transaction rolled back, whichever RPC.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_guard_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE why text;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  why:=atokore_private.purchase_undo_refusal_v51(NEW.household_id,OLD.op_id,OLD.body,OLD.actor);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_guard_v51() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_undo_guard_v51 BEFORE UPDATE OF body ON atokore_private.ops
FOR EACH ROW WHEN (OLD.type='complete_buy' AND NEW.body->>'_undo_done'='true' AND OLD.body->>'_undo_done' IS DISTINCT FROM 'true')
EXECUTE FUNCTION atokore_private.purchase_undo_guard_v51();

-- Work 9th (undo screen): the answer also carries the records the undo changed (the product and its shopping
-- row, as hh_pull returns them, with their change numbers), so the phone shows the confirmed result at once
-- from the server's own rows (idempotent by change number) instead of waiting for the next pull.
CREATE OR REPLACE FUNCTION public.hh_undo_purchases_v51(p_ops jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
  p jsonb; o atokore_private.ops%ROWTYPE; why text; r jsonb; v_recs jsonb;
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(h) THEN RETURN jsonb_build_object('status','not_enabled'); END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'bad_batch' USING ERRCODE='22023'; END IF;
  -- Every receipt of the batch is checked first; one expired purchase refuses the whole batch.
  FOR p IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    IF jsonb_typeof(p) IS DISTINCT FROM 'string' OR (lower(p #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
      THEN RAISE EXCEPTION 'purchase_not_reversible' USING ERRCODE='22023'; END IF;
    SELECT * INTO o FROM atokore_private.ops WHERE household_id=h AND op_id=(p #>> '{}')::uuid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;                     -- the existing RPC refuses unknown receipts
    IF o.body->>'_undo_done'='true' THEN CONTINUE; END IF;  -- an earlier undo answers its retry
    why:=atokore_private.purchase_undo_refusal_v51(h,o.op_id,o.body,o.actor);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  END LOOP;
  r:=public.hh_undo_purchases(p_ops);
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('kind',x.kind,'id',x.id,'fields',x.fields,'qty',x.qty,'deleted',x.deleted,'seq',x.seq)),'[]'::jsonb) INTO v_recs
    FROM atokore_private.ops op JOIN atokore_private.records x ON x.household_id=op.household_id
     AND ((x.kind='item' AND x.id=op.body->>'item') OR (x.kind='buy' AND x.id=op.body->>'buy'))
   WHERE op.household_id=h AND op.op_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(p_ops) e);
  RETURN r || jsonb_build_object('status','ready','records',v_recs);
END $fn$;
REVOKE ALL ON FUNCTION public.hh_undo_purchases_v51(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_undo_purchases_v51(jsonb) TO authenticated;
COMMIT;
