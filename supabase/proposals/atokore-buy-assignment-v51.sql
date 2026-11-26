-- DRAFT ONLY (v51). Shopping assignments with replies: 「買えるよ」/「今回は難しい」.
-- Not applied to any real project. Apply only with owner approval, after review.
--
-- Why a separate table and RPCs (not item/buy record fields): atokore_private.valid_field accepts any
-- client field key, so an assignment stored in record fields could be rewritten by any device
-- through hh_push. Here only these RPCs write, each one:
--   * locks the household and re-checks the caller's active membership (lock_member),
--   * locks the assignment row and compares the expected revision (stale updates are refused),
--   * follows the reviewed reference policy in atokore-live-v125/family-prep-v51.js
--     (assignmentPlan / assignmentResponsePlan; the PGlite tests compare both),
--   * touches the buy record's seq so other devices see a changed cursor and refetch,
--   * queues a generic notification id in an outbox (nothing is sent; see notify-policy-v51).
-- Removing a member releases what they were asked to buy (they are no longer active).
-- v51 (Work 4th review):
--   * replies other than exactly 'accept'/'decline' (NULL, blank, padded, other words) are invalid,
--   * a member who leaves (or is removed) loses their assignments at once, and their queued,
--     unsent notices are dropped (trigger on members.left_at),
--   * notify_due_v51 re-checks right before a notice would be sent that the recipient is still an
--     active member and the notice still matches the current assignment (nothing is sent here),
-- v51 (Work 6th review): a notice is reserved for one sender (notify_claim_v51: lease, expiry, retry
--   with backoff), re-authorized right before the provider call (notify_authorize_v51), and completed
--   exactly once (notify_complete_v51; replaces notify_mark_sent_v51). The idempotency key is the
--   notice id. An ambiguous answer is held, never resent, unless the provider is idempotent.
--   * every RPC answers only for households on the synthetic trial allowlist (server-side), so the
--     feature cannot be used by real households before an approved release.
BEGIN;
-- Synthetic trial households only (added by the operator for an isolated trial; never real people).
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
CREATE TABLE atokore_private.buy_assignments (
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  buy_id text NOT NULL CHECK (buy_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  assignee uuid,
  requester uuid NOT NULL,
  response text NOT NULL CHECK (response IN ('none','pending','accepted','declined')),
  rev integer NOT NULL CHECK (rev BETWEEN 1 AND 99999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, buy_id)
);
CREATE TABLE atokore_private.notify_outbox (
  id text PRIMARY KEY CHECK (char_length(id) <= 300),
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  recipient uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('assignment','assignment-response')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  dropped_at timestamptz,
  drop_reason text CHECK (drop_reason IN ('left','stale','resolved','gave_up')),
  -- Work 6th: one sender at a time (reservation with a lease), a record that a send may have started,
  -- a backoff after a definite rejection, and a hold after an ambiguous answer (never resent by itself).
  claim_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  send_started_at timestamptz,
  next_attempt_at timestamptz,
  ambiguous_at timestamptz,
  last_result text CHECK (last_result IN ('sent','failed','retry','ambiguous'))
);
ALTER TABLE atokore_private.buy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE atokore_private.notify_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.buy_assignments, atokore_private.notify_outbox FROM PUBLIC, anon, authenticated;

CREATE FUNCTION atokore_private.active_member_v51(p_hh uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM atokore_private.members m WHERE m.household_id = p_hh AND m.user_id = p_user AND m.left_at IS NULL)
$$;
REVOKE ALL ON FUNCTION atokore_private.active_member_v51(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Ask someone (or yourself, or nobody) to buy one shopping row.
CREATE FUNCTION public.hh_buy_assign(p_buy text, p_assignee uuid, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid; v_row atokore_private.buy_assignments%ROWTYPE;
  v_rev integer; v_current uuid; v_response text;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN jsonb_build_object('status', 'not_enabled'); END IF;
  IF p_buy IS NULL OR p_buy !~ '^[A-Za-z0-9_-]{8,64}$' OR p_expected_rev IS NULL OR p_expected_rev < 0 OR p_expected_rev > 99999
  THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  PERFORM 1 FROM atokore_private.records WHERE household_id = v_hh AND kind = 'buy' AND id = p_buy AND NOT deleted FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'gone'); END IF;
  SELECT * INTO v_row FROM atokore_private.buy_assignments WHERE household_id = v_hh AND buy_id = p_buy FOR UPDATE;
  v_rev := COALESCE(v_row.rev, 0);
  -- An assignee who left counts as nobody.
  v_current := CASE WHEN v_row.assignee IS NOT NULL AND atokore_private.active_member_v51(v_hh, v_row.assignee) THEN v_row.assignee END;
  IF v_rev <> p_expected_rev THEN
    RETURN jsonb_build_object('status', 'stale', 'rev', v_rev, 'assignee', v_current, 'response', COALESCE(v_row.response, 'none'));
  END IF;
  IF p_assignee IS NOT NULL AND NOT atokore_private.active_member_v51(v_hh, p_assignee) THEN
    RETURN jsonb_build_object('status', 'denied');
  END IF;
  IF v_current IS NOT DISTINCT FROM p_assignee AND COALESCE(v_row.response, 'none') <> 'declined' THEN
    RETURN jsonb_build_object('status', 'unchanged', 'rev', v_rev);
  END IF;
  IF v_rev >= 99999 THEN RAISE EXCEPTION 'revision_overflow' USING ERRCODE = '22003'; END IF;
  v_response := CASE WHEN p_assignee IS NULL THEN 'none' WHEN p_assignee = v_user THEN 'accepted' ELSE 'pending' END;
  INSERT INTO atokore_private.buy_assignments (household_id, buy_id, assignee, requester, response, rev, updated_at)
    VALUES (v_hh, p_buy, p_assignee, v_user, v_response, v_rev + 1, now())
    ON CONFLICT (household_id, buy_id) DO UPDATE SET assignee = EXCLUDED.assignee, requester = EXCLUDED.requester,
      response = EXCLUDED.response, rev = EXCLUDED.rev, updated_at = EXCLUDED.updated_at;
  UPDATE atokore_private.records SET seq = nextval('atokore_private.change_seq') WHERE household_id = v_hh AND kind = 'buy' AND id = p_buy;
  IF p_assignee IS NOT NULL AND p_assignee <> v_user THEN
    INSERT INTO atokore_private.notify_outbox (id, household_id, recipient, kind)
      VALUES (jsonb_build_array(v_hh, p_buy, v_rev + 1, 'assignment')::text, v_hh, p_assignee, 'assignment') ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('status', 'ready', 'rev', v_rev + 1, 'assignee', p_assignee, 'response', v_response);
END $fn$;

-- The person asked replies: 'accept' (買えるよ) or 'decline' (今回は難しい, which frees the row).
CREATE FUNCTION public.hh_buy_respond(p_buy text, p_decision text, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid; v_row atokore_private.buy_assignments%ROWTYPE; v_accept boolean;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN jsonb_build_object('status', 'not_enabled'); END IF;
  -- NULL NOT IN (...) is NULL, not true: NULL and blank replies must be refused explicitly.
  IF p_decision IS NULL OR p_decision NOT IN ('accept','decline') OR p_buy IS NULL OR p_buy !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_expected_rev IS NULL OR p_expected_rev < 1 OR p_expected_rev > 99999 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  PERFORM 1 FROM atokore_private.records WHERE household_id = v_hh AND kind = 'buy' AND id = p_buy AND NOT deleted FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'gone'); END IF;
  SELECT * INTO v_row FROM atokore_private.buy_assignments WHERE household_id = v_hh AND buy_id = p_buy FOR UPDATE;
  IF NOT FOUND OR v_row.assignee IS DISTINCT FROM v_user OR v_row.requester = v_user
     OR NOT atokore_private.active_member_v51(v_hh, v_row.requester) THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  IF v_row.rev <> p_expected_rev OR v_row.response <> 'pending' THEN RETURN jsonb_build_object('status', 'stale', 'rev', v_row.rev, 'response', v_row.response); END IF;
  IF v_row.rev >= 99999 THEN RAISE EXCEPTION 'revision_overflow' USING ERRCODE = '22003'; END IF;
  v_accept := p_decision = 'accept';
  UPDATE atokore_private.buy_assignments SET assignee = CASE WHEN v_accept THEN v_user END,
    response = CASE WHEN v_accept THEN 'accepted' ELSE 'declined' END, rev = rev + 1, updated_at = now()
    WHERE household_id = v_hh AND buy_id = p_buy;
  UPDATE atokore_private.records SET seq = nextval('atokore_private.change_seq') WHERE household_id = v_hh AND kind = 'buy' AND id = p_buy;
  INSERT INTO atokore_private.notify_outbox (id, household_id, recipient, kind)
    VALUES (jsonb_build_array(v_hh, p_buy, v_row.rev + 1, 'response')::text, v_hh, v_row.requester, 'assignment-response') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('status', 'ready', 'rev', v_row.rev + 1, 'response', CASE WHEN v_accept THEN 'accepted' ELSE 'declined' END);
END $fn$;

-- What the caller's household has assigned (live shopping rows only; leavers count as nobody).
CREATE FUNCTION public.hh_buy_assignments() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
BEGIN
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('buy_id', a.buy_id,
      'assignee', CASE WHEN atokore_private.active_member_v51(v_hh, a.assignee) THEN a.assignee END,
      'requester', a.requester, 'response', CASE WHEN a.assignee IS NOT NULL AND NOT atokore_private.active_member_v51(v_hh, a.assignee) THEN 'none' ELSE a.response END,
      'rev', a.rev) ORDER BY a.buy_id)
    FROM atokore_private.buy_assignments a JOIN atokore_private.records r
      ON r.household_id = a.household_id AND r.kind = 'buy' AND r.id = a.buy_id AND NOT r.deleted
    WHERE a.household_id = v_hh), '[]'::jsonb);
END $fn$;

-- A member who leaves: what they were asked to buy is released, requests they made that were not
-- answered are withdrawn, and unsent notices to them are dropped. Other devices see the change.
CREATE FUNCTION atokore_private.buy_assign_member_left_v51() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  WITH changed AS (
    UPDATE atokore_private.buy_assignments a SET assignee = NULL, response = 'none', rev = LEAST(a.rev + 1, 99999), updated_at = now()
     WHERE a.household_id = NEW.household_id AND (a.assignee = NEW.user_id OR (a.requester = NEW.user_id AND a.response = 'pending'))
     RETURNING a.buy_id)
  UPDATE atokore_private.records r SET seq = nextval('atokore_private.change_seq')
   FROM changed c WHERE r.household_id = NEW.household_id AND r.kind = 'buy' AND r.id = c.buy_id;
  UPDATE atokore_private.notify_outbox SET dropped_at = now(), drop_reason = 'left'
   WHERE household_id = NEW.household_id AND recipient = NEW.user_id AND sent_at IS NULL AND dropped_at IS NULL;
  RETURN NEW;
END $fn$;
CREATE TRIGGER buy_assign_member_left_v51 AFTER UPDATE OF left_at ON atokore_private.members
FOR EACH ROW WHEN (OLD.left_at IS NULL AND NEW.left_at IS NOT NULL) EXECUTE FUNCTION atokore_private.buy_assign_member_left_v51();
REVOKE ALL ON FUNCTION atokore_private.buy_assign_member_left_v51() FROM PUBLIC, anon, authenticated;

-- Why a notice is no longer to be sent (NULL: still current). Used at reservation and again right before
-- sending, so a change in between (left, taken back, answered, deleted, trial ended) stops it.
CREATE FUNCTION atokore_private.notify_stale_why_v51(o atokore_private.notify_outbox) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a atokore_private.buy_assignments%ROWTYPE; k jsonb := o.id::jsonb;
BEGIN
  IF NOT atokore_private.active_member_v51(o.household_id, o.recipient) THEN RETURN 'left'; END IF;
  SELECT * INTO a FROM atokore_private.buy_assignments WHERE household_id = o.household_id AND buy_id = k->>1;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM atokore_private.records r WHERE r.household_id = o.household_id AND r.kind = 'buy' AND r.id = k->>1 AND NOT r.deleted) THEN RETURN 'resolved'; END IF;
  IF o.kind = 'assignment' AND (a.rev <> (k->>2)::int OR a.assignee IS DISTINCT FROM o.recipient OR a.response <> 'pending') THEN RETURN 'stale'; END IF;
  IF o.kind = 'assignment-response' AND a.rev <> (k->>2)::int THEN RETURN 'stale'; END IF;
  RETURN NULL;
END $fn$;

-- Reserve notices for ONE sender (Work 6th: two calls handed out the same unsent notice). Rows are
-- locked with SKIP LOCKED and get a fresh claim token and a lease; while the lease runs nobody else
-- gets them. An expired lease may be taken over; `in_doubt` then tells the new sender that an earlier
-- attempt was authorized and may have delivered (only an idempotent provider may send again, with the
-- same key). Ambiguous answers are never reclaimed here. Nothing is sent by this function.
CREATE FUNCTION atokore_private.notify_claim_v51(p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o atokore_private.notify_outbox%ROWTYPE; out jsonb := '[]'::jsonb; why text; t uuid;
  v_lease interval := make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 600));
  v_max constant integer := 5;   -- attempts before a notice is given up (a notice is a nudge, not a duty)
BEGIN
  FOR o IN SELECT * FROM atokore_private.notify_outbox n
            WHERE n.sent_at IS NULL AND n.dropped_at IS NULL AND n.ambiguous_at IS NULL
              AND (n.lease_until IS NULL OR n.lease_until <= now()) AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= now())
              AND atokore_private.trial_allowed_v51(n.household_id)
            ORDER BY n.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED LOOP
    why := atokore_private.notify_stale_why_v51(o);
    IF why IS NULL AND o.attempts >= v_max THEN why := 'gave_up'; END IF;
    IF why IS NOT NULL THEN
      UPDATE atokore_private.notify_outbox SET dropped_at = now(), drop_reason = why, claim_token = NULL, lease_until = NULL WHERE id = o.id;
      CONTINUE;
    END IF;
    t := gen_random_uuid();
    UPDATE atokore_private.notify_outbox SET claim_token = t, lease_until = now() + v_lease, attempts = o.attempts + 1 WHERE id = o.id;
    out := out || jsonb_build_array(jsonb_build_object('id', o.id, 'recipient', o.recipient, 'kind', o.kind, 'token', t,
      'idempotency_key', o.id, 'attempt', o.attempts + 1, 'in_doubt', o.send_started_at IS NOT NULL));
  END LOOP;
  RETURN out;
END $fn$;
-- Kept name from the earlier draft: it now reserves (the old version returned the same notice to every
-- caller). Same fields as before plus the claim.
CREATE FUNCTION atokore_private.notify_due_v51(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT atokore_private.notify_claim_v51(p_limit, 120) $$;

-- Right before the provider call, in its own committed transaction: the caller must still hold the
-- lease, the household must still be in the trial, and the notice must still be current. Records that a
-- send may now happen (send_started_at), so a crash after this point is known to be in doubt.
CREATE FUNCTION atokore_private.notify_authorize_v51(p_id text, p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o atokore_private.notify_outbox%ROWTYPE; why text;
BEGIN
  SELECT * INTO o FROM atokore_private.notify_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'why', 'unknown'); END IF;
  IF o.sent_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'already_sent'); END IF;
  IF o.dropped_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'dropped'); END IF;
  IF o.ambiguous_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'why', 'ambiguous'); END IF;
  IF p_token IS NULL OR o.claim_token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('ok', false, 'why', 'not_owner'); END IF;
  IF o.lease_until IS NULL OR o.lease_until <= now() THEN RETURN jsonb_build_object('ok', false, 'why', 'lease_expired'); END IF;
  IF NOT atokore_private.trial_allowed_v51(o.household_id) THEN
    UPDATE atokore_private.notify_outbox SET claim_token = NULL, lease_until = NULL WHERE id = p_id;
    RETURN jsonb_build_object('ok', false, 'why', 'not_enabled');
  END IF;
  why := atokore_private.notify_stale_why_v51(o);
  IF why IS NOT NULL THEN
    UPDATE atokore_private.notify_outbox SET dropped_at = now(), drop_reason = why, claim_token = NULL, lease_until = NULL WHERE id = p_id;
    RETURN jsonb_build_object('ok', false, 'why', why);
  END IF;
  UPDATE atokore_private.notify_outbox SET send_started_at = COALESCE(send_started_at, now()) WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'idempotency_key', o.id, 'recipient', o.recipient, 'kind', o.kind);
END $fn$;

-- The sender's report, exactly once per outcome:
--   'sent'      the provider confirmed delivery (accepted from a late earlier attempt too: it only stops sends),
--   'failed'    the provider definitely did NOT deliver -> retry later with backoff (current holder only),
--   'retry'     no answer, but the provider is idempotent -> retry later with the same key, still in doubt,
--   'ambiguous' no answer and the provider is not idempotent -> held for review, never resent by itself.
CREATE FUNCTION atokore_private.notify_complete_v51(p_id text, p_token uuid, p_result text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o atokore_private.notify_outbox%ROWTYPE;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('sent','failed','retry','ambiguous') THEN
    RAISE EXCEPTION 'notify_result_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM atokore_private.notify_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o.sent_at IS NOT NULL THEN RETURN 'already_sent'; END IF;
  IF p_result = 'sent' THEN
    IF o.send_started_at IS NULL THEN RETURN 'not_authorized'; END IF;
    UPDATE atokore_private.notify_outbox SET sent_at = now(), last_result = 'sent', claim_token = NULL, lease_until = NULL WHERE id = p_id;
    RETURN 'marked';
  END IF;
  IF o.dropped_at IS NOT NULL THEN RETURN 'dropped'; END IF;
  IF p_token IS NULL OR o.claim_token IS DISTINCT FROM p_token THEN RETURN 'stale_token'; END IF;
  IF p_result = 'ambiguous' THEN
    UPDATE atokore_private.notify_outbox SET ambiguous_at = now(), last_result = 'ambiguous', claim_token = NULL, lease_until = NULL WHERE id = p_id;
    RETURN 'held_for_review';
  END IF;
  -- Backoff 30 s, 60 s, 120 s ... capped at one hour.
  UPDATE atokore_private.notify_outbox SET claim_token = NULL, lease_until = NULL, last_result = p_result,
    send_started_at = CASE WHEN p_result = 'failed' THEN NULL ELSE send_started_at END,
    next_attempt_at = now() + LEAST(make_interval(secs => 30 * power(2, GREATEST(o.attempts - 1, 0))), interval '1 hour')
   WHERE id = p_id;
  RETURN 'retry_scheduled';
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.notify_stale_why_v51(atokore_private.notify_outbox) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION atokore_private.notify_claim_v51(integer, integer), atokore_private.notify_due_v51(integer),
  atokore_private.notify_authorize_v51(text, uuid), atokore_private.notify_complete_v51(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA atokore_private TO service_role;
GRANT EXECUTE ON FUNCTION atokore_private.notify_claim_v51(integer, integer), atokore_private.notify_due_v51(integer),
  atokore_private.notify_authorize_v51(text, uuid), atokore_private.notify_complete_v51(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.hh_buy_assign(text, uuid, integer), public.hh_buy_respond(text, text, integer), public.hh_buy_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_buy_assign(text, uuid, integer), public.hh_buy_respond(text, text, integer), public.hh_buy_assignments() TO authenticated;
COMMIT;
-- Rollback: rollback/atokore-buy-assignment-v51.rollback.sql (keeps trial_allowed_v51 for the other units);
-- restore: rollback/atokore-buy-assignment-v51.restore.sql. They drop the public functions, active_member_v51,
-- the trigger and its function, the notify_* functions, and the two
-- tables (they hold only assignment state and queued notification ids; no stock or shopping data).
