-- DRAFT ONLY (v51). Share 曜日・行事・子どもの持ち物 and today's ticks with the household.
-- Not applied to any real project; owner approval and review are required first.
-- * The settings (children, weekly and event rows) are one small document per household with a
--   revision: hh_prep_put refuses a stale revision, so two phones never silently overwrite each other.
-- * Ticks are separate per day and row and idempotent (no revision): ticking on two phones at the
--   same moment cannot conflict. Ticks older than two days are removed by the next tick.
-- * Every call locks the household and re-checks active membership; leavers lose access at once.
-- * No stock, shopping or photo data is read or written.
-- v51 (Work 4th review): the server validates the whole document, not only its shape (missing
-- required fields, blank names, malformed or duplicate ids, rows for children that do not exist,
-- unknown keys), a tick must name a row that exists in THIS household's document for that day
-- (so another household's or a made-up row is refused), and only synthetic trial households
-- (server-side allowlist, shared with atokore-buy-assignment-v51.sql) can use it.
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

-- NULL when the document is valid, otherwise the first reason. Mirrors valid() in prep-sets-v51.js.
CREATE FUNCTION atokore_private.prep_doc_problem_v51(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $fn$
DECLARE c jsonb; ids text[] := '{}'; k text; v jsonb; d text; r jsonb; row_ids text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN 'not_object'; END IF;
  IF char_length(p::text) > 20000 THEN RETURN 'too_large'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) x WHERE x NOT IN ('v','children','week','events')) THEN RETURN 'unknown_key'; END IF;
  IF NOT (p ? 'v' AND p ? 'children' AND p ? 'week' AND p ? 'events') THEN RETURN 'missing_field'; END IF;
  IF p->'v' <> '1'::jsonb THEN RETURN 'version'; END IF;
  IF jsonb_typeof(p->'children') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'children') > 4 THEN RETURN 'children'; END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p->'children') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'id') IS DISTINCT FROM 'string' OR coalesce(c->>'id','') !~ '^[A-Za-z0-9_-]{1,60}$'
       OR jsonb_typeof(c->'name') IS DISTINCT FROM 'string' OR btrim(c->>'name') = '' OR char_length(c->>'name') > 40
       OR (c ? 'place' AND c->'place' <> 'null'::jsonb AND (jsonb_typeof(c->'place') IS DISTINCT FROM 'string' OR char_length(c->>'place') > 20))
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) x WHERE x NOT IN ('id','name','place')) THEN RETURN 'child'; END IF;
    IF (c->>'id') = ANY(ids) THEN RETURN 'duplicate_child'; END IF;
    ids := ids || (c->>'id');
  END LOOP;
  IF jsonb_typeof(p->'week') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'events') IS DISTINCT FROM 'object' THEN RETURN 'missing_field'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(p->'week') LOOP
    IF NOT (k = ANY(ids)) THEN RETURN 'unknown_child'; END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN 'week'; END IF;
    FOR d, r IN SELECT * FROM jsonb_each(v) LOOP
      IF d !~ '^[0-6]$' THEN RETURN 'week_day'; END IF;
      IF atokore_private.prep_rows_problem_v51(r) IS NOT NULL THEN RETURN atokore_private.prep_rows_problem_v51(r); END IF;
    END LOOP;
  END LOOP;
  FOR k, v IN SELECT * FROM jsonb_each(p->'events') LOOP
    IF NOT (k = ANY(ids)) THEN RETURN 'unknown_child'; END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN 'events'; END IF;
    FOR d, r IN SELECT * FROM jsonb_each(v) LOOP
      IF d !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(to_date(d, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> d THEN RETURN 'event_day'; END IF;
      IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('label','rows'))
         OR (r ? 'label' AND r->'label' <> 'null'::jsonb AND (jsonb_typeof(r->'label') IS DISTINCT FROM 'string' OR char_length(r->>'label') > 40)) THEN RETURN 'event'; END IF;
      IF atokore_private.prep_rows_problem_v51(r->'rows') IS NOT NULL THEN RETURN atokore_private.prep_rows_problem_v51(r->'rows'); END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN 'event_day';
END $fn$;
CREATE FUNCTION atokore_private.prep_rows_problem_v51(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $fn$
DECLARE r jsonb; seen text[] := '{}';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'array' OR jsonb_array_length(p) > 30 THEN RETURN 'rows'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p) LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR coalesce(r->>'id','') !~ '^[A-Za-z0-9_-]{1,60}$'
       OR jsonb_typeof(r->'name') IS DISTINCT FROM 'string' OR btrim(r->>'name') = '' OR char_length(r->>'name') > 40
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) x WHERE x NOT IN ('id','name')) THEN RETURN 'row'; END IF;
    IF (r->>'id') = ANY(seen) THEN RETURN 'duplicate_row'; END IF;
    seen := seen || (r->>'id');
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION atokore_private.prep_doc_problem_v51(jsonb), atokore_private.prep_rows_problem_v51(jsonb) FROM PUBLIC, anon, authenticated;
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
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN jsonb_build_object('status', 'not_enabled'); END IF;
  SELECT * INTO v_doc FROM atokore_private.prep_docs WHERE household_id = v_hh;
  RETURN jsonb_build_object('doc', v_doc.doc, 'rev', COALESCE(v_doc.rev, 0),
    'ticks', COALESCE((SELECT jsonb_agg(t.instance ORDER BY t.instance) FROM atokore_private.prep_ticks t WHERE t.household_id = v_hh AND t.day = p_day), '[]'::jsonb));
END $fn$;

CREATE FUNCTION public.hh_prep_put(p_doc jsonb, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid; v_rev integer; v_problem text;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN jsonb_build_object('status', 'not_enabled'); END IF;
  v_problem := atokore_private.prep_doc_problem_v51(p_doc);
  IF v_problem IS NOT NULL OR p_expected_rev IS NULL OR p_expected_rev < 0 OR p_expected_rev > 99999
  THEN RETURN jsonb_build_object('status', 'invalid', 'reason', COALESCE(v_problem, 'revision')); END IF;
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
DECLARE v_user uuid := atokore_private.require_user(); v_hh uuid; v_doc jsonb; v_key jsonb;
BEGIN
  v_hh := atokore_private.lock_member(v_user);
  IF v_hh IS NULL THEN RAISE EXCEPTION 'not_member' USING ERRCODE = '42501'; END IF;
  IF NOT atokore_private.trial_allowed_v51(v_hh) THEN RETURN jsonb_build_object('status', 'not_enabled'); END IF;
  IF p_day IS NULL OR p_instance IS NULL OR char_length(p_instance) NOT BETWEEN 1 AND 1300 OR p_done IS NULL
     OR p_day < current_date - 2 OR p_day > current_date + 1 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  -- The row must exist in this household's document for that day: [day, child id, row id], the
  -- weekly row of that weekday or an event row of that date. Made-up ids and another household's
  -- rows are refused.
  BEGIN v_key := p_instance::jsonb; EXCEPTION WHEN others THEN RETURN jsonb_build_object('status', 'invalid'); END;
  SELECT doc INTO v_doc FROM atokore_private.prep_docs WHERE household_id = v_hh;
  IF jsonb_typeof(v_key) IS DISTINCT FROM 'array' OR jsonb_array_length(v_key) <> 3 OR v_key->>0 IS DISTINCT FROM to_char(p_day, 'YYYY-MM-DD')
     OR jsonb_typeof(v_key->1) IS DISTINCT FROM 'string' OR jsonb_typeof(v_key->2) IS DISTINCT FROM 'string' OR v_doc IS NULL
     OR NOT (EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc #> ARRAY['week', v_key->>1, extract(dow FROM p_day)::int::text]) x WHERE x->>'id' = v_key->>2)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc #> ARRAY['events', v_key->>1, v_key->>0, 'rows']) x WHERE x->>'id' = v_key->>2))
  THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
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
