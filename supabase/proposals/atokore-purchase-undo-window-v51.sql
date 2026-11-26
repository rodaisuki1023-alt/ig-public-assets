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

-- Work 7th (P0): the time a purchase really happened on a phone cannot be proven from anything the phone
-- says (its clock, a token fetched afterwards). The server can prove only times it issued itself. So:
--   * the phone holds a CLOCK TICKET the server issued before the purchase (hh_clock_ticket_v51; refreshed
--     while the app is open), and sends its id with the purchase ("ck" in the complete_buy op);
--   * the window starts at the ticket's issue time — at or before the real purchase, so the window is
--     never longer than 10 minutes after the purchase, only (by the ticket's age) shorter;
--   * a purchase without a valid ticket of this household and this person, issued before the server
--     received the purchase (offline, older app, unknown origin), CANNOT be undone in a trial household
--     (purchase_undo_unprovable). Buying, stock and sync are unchanged; the stock can be corrected directly.
-- Previous versions (device "ts", earlier of two times) are removed.
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
DROP FUNCTION IF EXISTS atokore_private.purchase_undo_guard_v51(),
  atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb),
  atokore_private.purchase_undo_start_v51(timestamptz,jsonb);
CREATE TABLE IF NOT EXISTS atokore_private.purchase_clock_tickets_v51 (
  ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  user_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS purchase_clock_tickets_v51_issued ON atokore_private.purchase_clock_tickets_v51(issued_at);
ALTER TABLE atokore_private.purchase_clock_tickets_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.purchase_clock_tickets_v51 FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.hh_clock_ticket_v51() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u); t atokore_private.purchase_clock_tickets_v51%ROWTYPE;
BEGIN
  IF h IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE='42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(h) THEN RETURN jsonb_build_object('status','not_enabled'); END IF;
  -- Tickets older than a day can no longer open any window: removed as they are replaced.
  DELETE FROM atokore_private.purchase_clock_tickets_v51 WHERE issued_at < clock_timestamp()-interval '1 day';
  INSERT INTO atokore_private.purchase_clock_tickets_v51(household_id,user_id) VALUES(h,u) RETURNING * INTO t;
  RETURN jsonb_build_object('status','ready','ticket',t.ticket,'issued_at',(extract(epoch FROM t.issued_at)*1000)::bigint);
END $fn$;
REVOKE ALL ON FUNCTION public.hh_clock_ticket_v51() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_clock_ticket_v51() TO authenticated;

-- NULL while this purchase may still be undone; otherwise why not. Only trial households have a window.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_refusal_v51(p_hh uuid,p_at timestamptz,p_body jsonb,p_actor uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_issued timestamptz; v_ck uuid;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(p_hh) THEN RETURN NULL; END IF;
  BEGIN v_ck:=(p_body->>'ck')::uuid; EXCEPTION WHEN others THEN v_ck:=NULL; END;
  IF v_ck IS NOT NULL THEN
    SELECT t.issued_at INTO v_issued FROM atokore_private.purchase_clock_tickets_v51 t
     WHERE t.ticket=v_ck AND t.household_id=p_hh AND t.user_id=p_actor AND t.issued_at<=p_at;
  END IF;
  IF v_issued IS NULL THEN RETURN 'purchase_undo_unprovable'; END IF;
  IF clock_timestamp()-v_issued>=interval '10 minutes' THEN RETURN 'purchase_undo_expired'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb,uuid) FROM PUBLIC, anon, authenticated;

-- Estimate entries removed by an undo (Work 7th): a stale phone or tab that still has one cannot write it
-- back — the server drops it from any later write of that product (the write itself still applies).
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
CREATE OR REPLACE FUNCTION atokore_private.purchase_undone_strip_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u record;
BEGIN
  IF NEW.kind<>'item' OR NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  FOR u IN SELECT e.field,e.k FROM atokore_private.purchase_undone_entries_v51 e WHERE e.household_id=NEW.household_id AND e.item_id=NEW.id LOOP
    IF NEW.fields->u.field->>'k' = u.k THEN NEW.fields:=NEW.fields-u.field; END IF;
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undone_strip_v51() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_undone_strip_v51 ON atokore_private.records;
CREATE TRIGGER purchase_undone_strip_v51 BEFORE INSERT OR UPDATE OF fields ON atokore_private.records
FOR EACH ROW EXECUTE FUNCTION atokore_private.purchase_undone_strip_v51();

-- The guard on the receipt, in the same transaction as the undo itself (whichever RPC):
--   * an expired or unprovable undo is refused and the whole transaction is rolled back;
--   * (Work 7th, estimate) the estimate entries this purchase added ("est": [{field,k}], sent by the app
--     with the purchase) are removed from the product in the SAME transaction as the stock and the shopping
--     row — only while the field still holds that purchase (k), so a later purchase is never touched, and a
--     retry changes nothing. If the estimate had already counted it, the product is marked to be checked.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_guard_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE why text; e jsonb; v_fields jsonb; v_changed boolean:=false;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(NEW.household_id) THEN RETURN NEW; END IF;
  why:=atokore_private.purchase_undo_refusal_v51(NEW.household_id,OLD.at,OLD.body,OLD.actor);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(OLD.body->'est')='array' THEN
    SELECT r.fields INTO v_fields FROM atokore_private.records r
     WHERE r.household_id=NEW.household_id AND r.kind='item' AND r.id=OLD.body->>'item' FOR UPDATE;
    IF v_fields IS NOT NULL THEN
      FOR e IN SELECT * FROM jsonb_array_elements(OLD.body->'est') LOOP
        IF e->>'field' ~ '^tp[0-9a-z]{1,13}$' AND char_length(coalesce(e->>'k',''))BETWEEN 1 AND 80 THEN
          INSERT INTO atokore_private.purchase_undone_entries_v51(household_id,item_id,field,k,op_id)
           VALUES(NEW.household_id,OLD.body->>'item',e->>'field',e->>'k',OLD.op_id) ON CONFLICT DO NOTHING;
        END IF;
        IF e->>'field' ~ '^tp[0-9a-z]{1,13}$' AND char_length(coalesce(e->>'k',''))BETWEEN 1 AND 80
           AND v_fields->(e->>'field')->>'k' = e->>'k' THEN
          v_fields:=v_fields-(e->>'field'); v_changed:=true;
          IF jsonb_typeof(v_fields->'track'->'seen')='array' AND (v_fields->'track'->'seen') ? (e->>'k') THEN
            v_fields:=jsonb_set(v_fields,'{track,check}','"purchase_undo"'::jsonb,true);
          END IF;
        END IF;
      END LOOP;
      IF v_changed THEN
        UPDATE atokore_private.records SET fields=v_fields,seq=nextval('atokore_private.change_seq'),updated_at=clock_timestamp()
         WHERE household_id=NEW.household_id AND kind='item' AND id=OLD.body->>'item';
      END IF;
    END IF;
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
    why:=atokore_private.purchase_undo_refusal_v51(h,o.at,o.body,o.actor);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  END LOOP;
  RETURN public.hh_undo_purchases(p_ops) || jsonb_build_object('status','ready');
END $fn$;
REVOKE ALL ON FUNCTION public.hh_undo_purchases_v51(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_undo_purchases_v51(jsonb) TO authenticated;
COMMIT;
