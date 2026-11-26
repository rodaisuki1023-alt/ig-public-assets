-- PROPOSAL ONLY (v51, purchase-undo window). Not a migration; not applied to any real project.
--
-- What changed from the first draft (Work review): the existing public.hh_undo_purchases is NOT
-- replaced (that would change every household at once). A separate RPC, hh_undo_purchases_v51, adds the
-- window and answers only for households on the synthetic trial allowlist; the app calls it only when
-- its config flag purchaseUndoWindowV51 is true (default false) and falls back to the existing RPC when
-- the server answers not_enabled. Rollback: DROP FUNCTION public.hh_undo_purchases_v51(jsonb) — the
-- existing RPC, the receipts (ops) and the purchase history are untouched.
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
-- Verified only in isolated PGlite (tests/atokore-purchase-undo-window-v51.test.cjs).
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

-- When the undo window of one stored purchase receipt started (milliseconds since the epoch).
CREATE FUNCTION atokore_private.purchase_undo_start_v51(p_at timestamptz,p_body jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE v_at bigint:=(extract(epoch FROM p_at)*1000)::bigint; v_dev bigint;
BEGIN
  BEGIN v_dev:=(p_body->>'ts')::bigint; EXCEPTION WHEN others THEN v_dev:=NULL; END;
  IF v_dev IS NULL THEN RETURN v_at; END IF;
  v_dev:=least(greatest(v_dev,v_at-2592000000),v_at+60000);
  RETURN least(v_at,v_dev);
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.purchase_undo_start_v51(timestamptz,jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hh_undo_purchases_v51(p_ops jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
  p jsonb; o atokore_private.ops%ROWTYPE; now_ms bigint:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
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
    IF now_ms-atokore_private.purchase_undo_start_v51(o.at,o.body)>=600000 THEN
      RAISE EXCEPTION 'purchase_undo_expired' USING ERRCODE='22023';
    END IF;
  END LOOP;
  RETURN public.hh_undo_purchases(p_ops) || jsonb_build_object('status','ready');
END $fn$;
REVOKE ALL ON FUNCTION public.hh_undo_purchases_v51(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_undo_purchases_v51(jsonb) TO authenticated;
COMMIT;
