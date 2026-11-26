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
  drop_reason text CHECK (drop_reason IN ('left','stale','resolved'))
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

-- Right before a (future, separately approved) sender would deliver: drop notices whose recipient is
-- no longer an active member, or that no longer match the current assignment; return the rest.
-- Marks nothing as sent and sends nothing.
CREATE FUNCTION atokore_private.notify_due_v51(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o atokore_private.notify_outbox%ROWTYPE; a atokore_private.buy_assignments%ROWTYPE; k jsonb; out jsonb := '[]'::jsonb; why text;
BEGIN
  FOR o IN SELECT * FROM atokore_private.notify_outbox WHERE sent_at IS NULL AND dropped_at IS NULL ORDER BY created_at
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED LOOP
    why := NULL; k := o.id::jsonb;
    SELECT * INTO a FROM atokore_private.buy_assignments WHERE household_id = o.household_id AND buy_id = k->>1;
    IF NOT atokore_private.active_member_v51(o.household_id, o.recipient) THEN why := 'left';
    ELSIF NOT FOUND OR NOT EXISTS (SELECT 1 FROM atokore_private.records r WHERE r.household_id = o.household_id AND r.kind = 'buy' AND r.id = k->>1 AND NOT r.deleted) THEN why := 'resolved';
    ELSIF o.kind = 'assignment' AND (a.rev <> (k->>2)::int OR a.assignee IS DISTINCT FROM o.recipient OR a.response <> 'pending') THEN why := 'stale';
    ELSIF o.kind = 'assignment-response' AND a.rev <> (k->>2)::int THEN why := 'stale';
    END IF;
    IF why IS NOT NULL THEN
      UPDATE atokore_private.notify_outbox SET dropped_at = now(), drop_reason = why WHERE id = o.id;
    ELSE
      out := out || jsonb_build_array(jsonb_build_object('id', o.id, 'recipient', o.recipient, 'kind', o.kind));
    END IF;
  END LOOP;
  RETURN out;
END $fn$;
-- After a (future, separately approved) sender delivered one notice: idempotent, exactly once.
-- A dropped notice is never marked sent; a second call answers already_sent and changes nothing.
CREATE FUNCTION atokore_private.notify_mark_sent_v51(p_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE o atokore_private.notify_outbox%ROWTYPE;
BEGIN
  SELECT * INTO o FROM atokore_private.notify_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o.sent_at IS NOT NULL THEN RETURN 'already_sent'; END IF;
  IF o.dropped_at IS NOT NULL THEN RETURN 'dropped'; END IF;
  UPDATE atokore_private.notify_outbox SET sent_at = now() WHERE id = p_id;
  RETURN 'marked';
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.notify_mark_sent_v51(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atokore_private.notify_mark_sent_v51(text) TO service_role;
REVOKE ALL ON FUNCTION atokore_private.notify_due_v51(integer) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA atokore_private TO service_role;
GRANT EXECUTE ON FUNCTION atokore_private.notify_due_v51(integer) TO service_role;

REVOKE ALL ON FUNCTION public.hh_buy_assign(text, uuid, integer), public.hh_buy_respond(text, text, integer), public.hh_buy_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_buy_assign(text, uuid, integer), public.hh_buy_respond(text, text, integer), public.hh_buy_assignments() TO authenticated;
COMMIT;
-- Rollback (after review): REVOKE/DROP the three public functions, active_member_v51, the trigger
-- and its function, notify_due_v51, trial_allowed_v51, and the three
-- tables (they hold only assignment state and queued notification ids; no stock or shopping data).
