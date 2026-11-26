-- ROLLBACK DRAFT for atokore-prep-share-v51.sql only (unit D). Not applied anywhere.
-- Keeps the shared trial allowlist (trial_households_v51 / trial_allowed_v51). Copies every row first
-- (see atokore-prep-share-v51.restore.sql). Each phone keeps its own copy of the preparation lists.
BEGIN;
DO $g$ BEGIN
  IF to_regclass('atokore_private.rollback_prep_docs_v51') IS NOT NULL THEN
    RAISE EXCEPTION 'prep_backup_exists' USING ERRCODE = '55000', HINT = 'Restore or archive the earlier backup first.';
  END IF;
END $g$;
CREATE TABLE atokore_private.rollback_prep_docs_v51 AS SELECT *, now() AS backed_up_at FROM atokore_private.prep_docs;
CREATE TABLE atokore_private.rollback_prep_ticks_v51 AS SELECT *, now() AS backed_up_at FROM atokore_private.prep_ticks;
ALTER TABLE atokore_private.rollback_prep_docs_v51 ENABLE ROW LEVEL SECURITY;
ALTER TABLE atokore_private.rollback_prep_ticks_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.rollback_prep_docs_v51, atokore_private.rollback_prep_ticks_v51 FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.hh_prep_get(date), public.hh_prep_put(jsonb, integer), public.hh_prep_tick(date, text, boolean),
  atokore_private.prep_doc_problem_v51(jsonb), atokore_private.prep_rows_problem_v51(jsonb);
DROP TABLE atokore_private.prep_docs, atokore_private.prep_ticks;
COMMIT;
