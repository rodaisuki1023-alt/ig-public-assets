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
CREATE OR REPLACE FUNCTION public.hh_push_v51(p_ops jsonb, p_receipt_ops jsonb, p_device text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
  r jsonb; x jsonb; v_want uuid[]:='{}'; v_id uuid; o atokore_private.ops%ROWTYPE; v_given jsonb:='[]'::jsonb;
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(h) THEN RETURN jsonb_build_object('status','not_enabled'); END IF;
  IF jsonb_typeof(p_receipt_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipt_ops) > 100 THEN RAISE EXCEPTION 'bad_batch' USING ERRCODE='22023'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_receipt_ops) LOOP
    BEGIN v_id:=(x #>> '{}')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'bad_batch' USING ERRCODE='22023'; END;
    v_want:=v_want||v_id;
  END LOOP;
  r:=public.hh_push(p_ops,p_device);
  FOR x IN SELECT * FROM jsonb_array_elements(r->'results') LOOP
    CONTINUE WHEN x->>'status' IS DISTINCT FROM 'applied';
    BEGIN v_id:=(x->>'op_id')::uuid; EXCEPTION WHEN others THEN CONTINUE; END;
    CONTINUE WHEN NOT (v_id = ANY(v_want));
    SELECT * INTO o FROM atokore_private.ops WHERE household_id=h AND op_id=v_id;
    CONTINUE WHEN NOT FOUND OR o.type<>'complete_buy' OR o.result<>'applied' OR o.actor<>u;
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

-- ---- The forecast, owned by the purchase (Work 8th) --------------------------------------------------
-- An estimate entry (item field tp…) of a purchase made while sharing carries the shared shopping rows it
-- came from ("sb": [buy ids]). Ownership is decided by the SERVER from that and the purchase's own row:
-- the entry belongs to the complete_buy of this product whose buy is in sb. The app's "est" list is no
-- longer trusted (an arbitrary or wrongly linked est cannot remove or revive another purchase's entry).
-- Undone entries (tombstones), the write-backs refused and the quarantine survive a rollback of the undo
-- window (rollback/atokore-purchase-undo-window-v51.rollback.sql keeps them and the write-back guard).
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
-- A write of an undone entry whose owner cannot be shown is kept here (never deleted by guess, never
-- counted). It is re-adopted if a purchase that owns it is applied later (a set that arrived first).
CREATE TABLE IF NOT EXISTS atokore_private.purchase_forecast_quarantine_v51 (
  id bigserial PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  item_id text NOT NULL,
  field text NOT NULL,
  value jsonb NOT NULL,
  reason text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE atokore_private.purchase_forecast_quarantine_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.purchase_forecast_quarantine_v51 FROM PUBLIC, anon, authenticated;
-- Is there a live (applied, not undone) purchase of this product, from a row in the entry's sb, applied
-- after p_since? That purchase owns the entry (a re-purchase of the same row is a new purchase).
CREATE OR REPLACE FUNCTION atokore_private.purchase_entry_owner_v51(p_hh uuid,p_item text,p_value jsonb,p_since timestamptz) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT o.op_id FROM atokore_private.ops o
   WHERE jsonb_typeof(p_value->'sb')='array' AND o.household_id=p_hh AND o.type='complete_buy' AND o.result='applied'
     AND o.body->>'item'=p_item AND (p_value->'sb') ? (o.body->>'buy') AND coalesce(o.body->>'_undo_done','')<>'true'
     AND o.at>p_since
   ORDER BY o.at DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION atokore_private.purchase_entry_owner_v51(uuid,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION atokore_private.purchase_undone_strip_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u record; v jsonb;
BEGIN
  IF NEW.kind<>'item' OR NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  FOR u IN SELECT e.field,e.k,e.undone_at FROM atokore_private.purchase_undone_entries_v51 e WHERE e.household_id=NEW.household_id AND e.item_id=NEW.id LOOP
    v:=NEW.fields->u.field;
    CONTINUE WHEN v IS NULL OR v->>'k' IS DISTINCT FROM u.k;
    IF atokore_private.purchase_entry_owner_v51(NEW.household_id,NEW.id,v,u.undone_at) IS NOT NULL THEN
      -- A purchase made after the undo owns this entry now (the same row bought again).
      DELETE FROM atokore_private.purchase_undone_entries_v51 WHERE household_id=NEW.household_id AND item_id=NEW.id AND field=u.field AND k=u.k;
    ELSE
      NEW.fields:=NEW.fields-u.field;
      IF TG_OP='UPDATE' AND OLD.fields->u.field IS NOT DISTINCT FROM v THEN CONTINUE; END IF;
      INSERT INTO atokore_private.purchase_forecast_quarantine_v51(household_id,item_id,field,value,reason)
       VALUES(NEW.household_id,NEW.id,u.field,v,CASE WHEN jsonb_typeof(v->'sb')='array' THEN 'undone_write_back' ELSE 'owner_unknown' END);
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undone_strip_v51() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_undone_strip_v51 ON atokore_private.records;
CREATE TRIGGER purchase_undone_strip_v51 BEFORE INSERT OR UPDATE OF fields ON atokore_private.records
FOR EACH ROW EXECUTE FUNCTION atokore_private.purchase_undone_strip_v51();
-- A purchase applied after its estimate entry was held (the set reached the server first): the held entry
-- of that row and product is put back, without replacing anything already there.
CREATE OR REPLACE FUNCTION atokore_private.purchase_readopt_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q record;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NULL; END IF;
  FOR q IN SELECT * FROM atokore_private.purchase_forecast_quarantine_v51 z
            WHERE z.household_id=NEW.household_id AND z.item_id=NEW.body->>'item'
              AND jsonb_typeof(z.value->'sb')='array' AND (z.value->'sb') ? (NEW.body->>'buy') ORDER BY z.id LOOP
    DELETE FROM atokore_private.purchase_undone_entries_v51 WHERE household_id=q.household_id AND item_id=q.item_id AND field=q.field AND k=q.value->>'k';
    UPDATE atokore_private.records SET fields=fields||jsonb_build_object(q.field,q.value),seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
     WHERE household_id=q.household_id AND kind='item' AND id=q.item_id AND NOT deleted AND NOT (fields ? q.field);
    DELETE FROM atokore_private.purchase_forecast_quarantine_v51 WHERE id=q.id;
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_readopt_v51() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_readopt_v51 ON atokore_private.ops;
CREATE TRIGGER purchase_readopt_v51 AFTER UPDATE OF result ON atokore_private.ops
FOR EACH ROW WHEN (NEW.type='complete_buy' AND NEW.result='applied' AND OLD.result IS DISTINCT FROM 'applied')
EXECUTE FUNCTION atokore_private.purchase_readopt_v51();

-- The guard on the receipt, in the same transaction as the undo itself (whichever RPC):
--   * an expired or unprovable undo is refused and the whole transaction is rolled back;
--   * the entries THIS purchase owns (sb holds its row) are removed in the same transaction and
--     remembered (a stale write cannot bring them back); an entry of several rows bought together cannot
--     be split, so the product is marked to be checked instead; an old entry without sb that the app
--     listed (est) cannot be verified: it is kept and the product is marked to be checked. Entries of other
--     purchases are never touched, whatever est says. If the estimate already counted it -> checked.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_guard_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE why text; f text; v jsonb; v_fields jsonb; v_changed boolean:=false; v_buy text:=OLD.body->>'buy';
  v_check boolean:=false;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  why:=atokore_private.purchase_undo_refusal_v51(NEW.household_id,OLD.op_id,OLD.body,OLD.actor);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  SELECT r.fields INTO v_fields FROM atokore_private.records r
   WHERE r.household_id=NEW.household_id AND r.kind='item' AND r.id=OLD.body->>'item' FOR UPDATE;
  IF v_fields IS NULL THEN RETURN NEW; END IF;
  FOR f,v IN SELECT * FROM jsonb_each(v_fields) LOOP
    CONTINUE WHEN f !~ '^tp[0-9a-z]{1,13}$' OR jsonb_typeof(v)<>'object' OR char_length(coalesce(v->>'k','')) NOT BETWEEN 1 AND 80;
    IF jsonb_typeof(v->'sb')='array' AND (v->'sb') ? v_buy THEN
      IF jsonb_array_length(v->'sb')=1 THEN
        v_fields:=v_fields-f; v_changed:=true;
        INSERT INTO atokore_private.purchase_undone_entries_v51(household_id,item_id,field,k,op_id)
         VALUES(NEW.household_id,OLD.body->>'item',f,v->>'k',OLD.op_id)
         ON CONFLICT (household_id,item_id,field,k) DO UPDATE SET op_id=EXCLUDED.op_id,undone_at=clock_timestamp();
        IF jsonb_typeof(v_fields->'track'->'seen')='array' AND (v_fields->'track'->'seen') ? (v->>'k') THEN v_check:=true; END IF;
      ELSE v_check:=true;
      END IF;
    ELSIF v->'sb' IS NULL AND jsonb_typeof(OLD.body->'est')='array'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.body->'est') e WHERE e->>'field'=f AND e->>'k'=v->>'k') THEN
      v_check:=true;
    END IF;
  END LOOP;
  IF v_check AND jsonb_typeof(v_fields->'track')='object' THEN v_fields:=jsonb_set(v_fields,'{track,check}','"purchase_undo"'::jsonb,true); v_changed:=true; END IF;
  IF v_changed THEN
    UPDATE atokore_private.records SET fields=v_fields,seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
     WHERE household_id=NEW.household_id AND kind='item' AND id=OLD.body->>'item';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_guard_v51() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_undo_guard_v51 BEFORE UPDATE OF body ON atokore_private.ops
FOR EACH ROW WHEN (OLD.type='complete_buy' AND NEW.body->>'_undo_done'='true' AND OLD.body->>'_undo_done' IS DISTINCT FROM 'true')
EXECUTE FUNCTION atokore_private.purchase_undo_guard_v51();

CREATE OR REPLACE FUNCTION public.hh_undo_purchases_v51(p_ops jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
  p jsonb; o atokore_private.ops%ROWTYPE; why text;
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(h) THEN RETURN jsonb_build_object('status','not_enabled'); END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'bad_batch' USING ERRCODE='22023'; END IF;
  -- Every receipt of the batch is checked first; one expired purchase refuses the whole batch.
  FOR p IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    BEGIN o.op_id:=(p #>> '{}')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'purchase_not_reversible' USING ERRCODE='22023'; END;
    SELECT * INTO o FROM atokore_private.ops WHERE household_id=h AND op_id=(p #>> '{}')::uuid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;                     -- the existing RPC refuses unknown receipts
    IF o.body->>'_undo_done'='true' THEN CONTINUE; END IF;  -- an earlier undo answers its retry
    why:=atokore_private.purchase_undo_refusal_v51(h,o.op_id,o.body,o.actor);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  END LOOP;
  RETURN public.hh_undo_purchases(p_ops) || jsonb_build_object('status','ready');
END $fn$;
REVOKE ALL ON FUNCTION public.hh_undo_purchases_v51(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_undo_purchases_v51(jsonb) TO authenticated;
COMMIT;
