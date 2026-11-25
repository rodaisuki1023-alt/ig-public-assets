-- DRAFT ONLY (v51). Share 曜日・行事・子どもの持ち物 and today's ticks with the household.
-- Not applied to any real project; owner approval and review are required first.
-- * The settings (children, weekly and event rows) are one small document per household with a
--   revision: hh_prep_put refuses a stale revision, so two phones never silently overwrite each other.
-- * Ticks are separate per day and row and idempotent (no revision): ticking on two phones at the
--   same moment cannot conflict. Ticks older than two days are removed by the next tick.
-- * Every call locks the household and re-checks active membership; leavers lose access at once.
-- * No stock, shopping or photo data is read or written.
BEGIN;
CREATE TABLE atokore_private.prep_docs (
  household_id uuid PRIMARY KEY REFERENCES atokore_private.households(id),
  doc jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object' AND char_length(doc::text) <= 20000),
  rev integer NOT NULL CHECK (rev BETWEEN 1 AND 99999),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE atokore_private.prep_ticks (
  household_id uuid NOT NULL REFERENCES atokore_private.households(id),
  day date NOT NULL,
  instance text NOT NULL CHECK (char_length(instance) BETWEEN 1 AND 1300),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, day, instance)
);
ALTER TABLE atokore_private.prep_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atokore_private.prep_ticks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.prep_docs, atokore_private.prep_ticks FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hh_prep_get(p_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); v_doc atokore_private.prep_docs%ROWTYPE;
BEGIN
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_doc FROM atokore_private.prep_docs WHERE household_id = v_hh;
  RETURN jsonb_build_object('doc', v_doc.doc, 'rev', COALESCE(v_doc.rev, 0),
    'ticks', COALESCE((SELECT jsonb_agg(t.instance ORDER BY t.instance) FROM atokore_private.prep_ticks t WHERE t.household_id = v_hh AND t.day = p_day), '[]'::jsonb));
END $fn$;

CREATE FUNCTION public.hh_prep_put(p_doc jsonb, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid; v_rev integer;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  -- Shape only (the app validates fully): version 1, at most 4 children, no tick data, size bound.
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' OR p_doc->>'v' <> '1' OR jsonb_typeof(p_doc->'children') <> 'array'
     OR jsonb_array_length(p_doc->'children') > 4 OR p_doc ? 'done' OR char_length(p_doc::text) > 20000
     OR p_expected_rev IS NULL OR p_expected_rev < 0
  THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT rev INTO v_rev FROM atokore_private.prep_docs WHERE household_id = v_hh FOR UPDATE;
  v_rev := COALESCE(v_rev, 0);
  IF v_rev <> p_expected_rev THEN RETURN jsonb_build_object('status', 'stale', 'rev', v_rev); END IF;
  IF v_rev >= 99999 THEN RAISE EXCEPTION 'revision_overflow' USING ERRCODE = '22003'; END IF;
  INSERT INTO atokore_private.prep_docs (household_id, doc, rev, updated_by) VALUES (v_hh, p_doc, v_rev + 1, v_user)
    ON CONFLICT (household_id) DO UPDATE SET doc = EXCLUDED.doc, rev = EXCLUDED.rev, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('status', 'ready', 'rev', v_rev + 1);
END $fn$;

CREATE FUNCTION public.hh_prep_tick(p_day date, p_instance text, p_done boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF p_day IS NULL OR p_instance IS NULL OR char_length(p_instance) NOT BETWEEN 1 AND 1300 OR p_done IS NULL
     OR p_day < current_date - 2 OR p_day > current_date + 1 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF p_done THEN
    INSERT INTO atokore_private.prep_ticks (household_id, day, instance, updated_by) VALUES (v_hh, p_day, p_instance, v_user) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM atokore_private.prep_ticks WHERE household_id = v_hh AND day = p_day AND instance = p_instance;
  END IF;
  DELETE FROM atokore_private.prep_ticks WHERE household_id = v_hh AND day < current_date - 2;
  RETURN jsonb_build_object('status', 'ready');
END $fn$;

REVOKE ALL ON FUNCTION public.hh_prep_get(date), public.hh_prep_put(jsonb, integer), public.hh_prep_tick(date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hh_prep_get(date), public.hh_prep_put(jsonb, integer), public.hh_prep_tick(date, text, boolean) TO authenticated;
COMMIT;
-- Rollback (after review): drop the three functions and the two tables (preparation data only).
