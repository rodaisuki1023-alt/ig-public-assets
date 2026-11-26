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

-- When the undo window of one stored purchase receipt started (milliseconds since the epoch), or NULL
-- when the phone's time cannot be trusted (missing, not a whole number, not positive, or more than 60 s
-- ahead of the server's receive time).
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_start_v51(p_at timestamptz,p_body jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE v_at bigint:=(extract(epoch FROM p_at)*1000)::bigint; v_dev numeric;
BEGIN
  IF p_at IS NULL OR jsonb_typeof(p_body->'ts') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  v_dev:=(p_body->>'ts')::numeric;
  IF v_dev<>trunc(v_dev) OR v_dev<=0 OR v_dev>v_at+60000 THEN RETURN NULL; END IF;
  RETURN least(v_at,v_dev::bigint);
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_start_v51(timestamptz,jsonb) FROM PUBLIC, anon, authenticated;

-- NULL while this purchase may still be undone; otherwise why not. Only trial households have a window.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_refusal_v51(p_hh uuid,p_at timestamptz,p_body jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v_start bigint; now_ms bigint:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
BEGIN
  IF NOT atokore_private.trial_allowed_v51(p_hh) THEN RETURN NULL; END IF;
  v_start:=atokore_private.purchase_undo_start_v51(p_at,p_body);
  IF v_start IS NULL THEN RETURN 'purchase_undo_time_invalid'; END IF;
  IF now_ms-v_start>=600000 THEN RETURN 'purchase_undo_expired'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_refusal_v51(uuid,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;

-- The guard on the receipt: whichever RPC marks a purchase undone, an expired or untrusted one is refused
-- and the whole transaction (the batch, the stock and shopping changes) is rolled back.
CREATE OR REPLACE FUNCTION atokore_private.purchase_undo_guard_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE why text;
BEGIN
  why:=atokore_private.purchase_undo_refusal_v51(NEW.household_id,OLD.at,OLD.body);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_guard_v51() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_undo_guard_v51 ON atokore_private.ops;
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
    why:=atokore_private.purchase_undo_refusal_v51(h,o.at,o.body);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='22023'; END IF;
  END LOOP;
  RETURN public.hh_undo_purchases(p_ops) || jsonb_build_object('status','ready');
END $fn$;
REVOKE ALL ON FUNCTION public.hh_undo_purchases_v51(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_undo_purchases_v51(jsonb) TO authenticated;
COMMIT;
