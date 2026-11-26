-- RESTORE DRAFT for unit D, after atokore-prep-share-v51.sql was applied again on top of a rollback.
BEGIN;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM atokore_private.prep_docs) OR EXISTS (SELECT 1 FROM atokore_private.prep_ticks) THEN
    RAISE EXCEPTION 'prep_tables_not_empty' USING ERRCODE = '55000';
  END IF;
END $g$;
INSERT INTO atokore_private.prep_docs (household_id, doc, rev, updated_by, updated_at)
  SELECT household_id, doc, rev, updated_by, updated_at FROM atokore_private.rollback_prep_docs_v51;
INSERT INTO atokore_private.prep_ticks (household_id, day, instance, updated_by, updated_at)
  SELECT household_id, day, instance, updated_by, updated_at FROM atokore_private.rollback_prep_ticks_v51;
DROP TABLE atokore_private.rollback_prep_docs_v51, atokore_private.rollback_prep_ticks_v51;
COMMIT;
