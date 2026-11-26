-- DRAFT ONLY (v51, A1). Stage 2 of closing the legacy photo bucket. Requires stage 1
-- (atokore-photo-legacy-close-writes-v51.sql). Not applied to any real project; owner approval required.
--
-- Refuses to run while ANY legacy object or legacy reference remains (see the guard). The order this enforces:
--   copy + verify + CAS switch (atokore-photo-legacy-migrate-v51.sql, photo-orphan-worker-v51.mjs)
--   -> delete the legacy object through the Storage API (never SQL) -> finish
--   -> this file closes client reads and deletes on the legacy bucket.
-- After this file the origin refuses every client request for the legacy bucket. Whether the CDN still
-- answers an earlier URL must be measured on the real project (Free plan has no purge API); until that
-- probe returns no image, the A1 release gate stays FAIL.
BEGIN;
-- v51 (Work 4th review): closing also requires that NOTHING still points at a legacy photo. With 0
-- legacy objects but 1 legacy reference the previous guard closed reads and left that product with a
-- broken photo. Now all of these must hold, checked under locks so nothing changes in between:
--   * no object left in the legacy bucket,
--   * no record (live or deleted) whose photoPath has no attached ledger row (a legacy reference),
--   * no unfinished legacy move (atokore-photo-legacy-migrate-v51.sql),
--   * ledger, references and objects agree: each attached row has its live record pointing at it
--     and its object in the managed bucket,
--   * stage 1 already applied.
-- Two people running this at once: the advisory lock serializes them, and the second one finds the
-- read policy already gone and changes nothing. A record write or a legacy move commit that runs at the
-- same time waits for this transaction (or this one waits for it) because of the SHARE locks.
SELECT pg_advisory_xact_lock(hashtext('atokore_legacy_photo_close_v51'));
LOCK TABLE atokore_private.records IN SHARE MODE;
LOCK TABLE storage.objects IN SHARE MODE;
DO $guard$
BEGIN
  IF to_regclass('atokore_private.photo_ledger_v50') IS NULL OR to_regclass('atokore_private.photo_legacy_moves_v51') IS NULL THEN
    RAISE EXCEPTION 'photo_ledger_missing' USING ERRCODE = '55000',
      HINT = 'Apply the reviewed ledger (reservation/lifecycle v50) and legacy-migrate v51 first.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'atokore-product-photos') THEN
    RAISE EXCEPTION 'legacy_photos_remain' USING ERRCODE = '55000',
      HINT = 'Migrate and delete every legacy object through the Storage API first (see legacy_photo_inventory()).';
  END IF;
  IF EXISTS (SELECT 1 FROM atokore_private.records r
             WHERE r.fields->>'photoPath' IS NOT NULL
               AND atokore_private.photo_is_legacy_ref_v51(r.household_id, r.id, r.fields->>'photoPath')) THEN
    RAISE EXCEPTION 'legacy_references_remain' USING ERRCODE = '55000',
      HINT = 'Some products still point at a legacy photo path. Move them (photo_legacy_begin/commit) or clear them after review.';
  END IF;
  IF EXISTS (SELECT 1 FROM atokore_private.photo_legacy_moves_v51 WHERE state IN ('copying','switched')) THEN
    RAISE EXCEPTION 'legacy_migration_unfinished' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM atokore_private.photo_ledger_v50 l
             WHERE l.state = 'attached' AND (
               NOT EXISTS (SELECT 1 FROM atokore_private.records r WHERE r.household_id = l.household_id AND r.kind = 'item'
                           AND r.id = l.record_id AND NOT r.deleted AND r.fields->>'photoPath' = atokore_private.photo_object_path_v50(l))
               OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'atokore-private-photos-v2'
                              AND o.name = atokore_private.photo_object_path_v50(l)))) THEN
    RAISE EXCEPTION 'photo_ledger_inconsistent' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'atokore_photo_insert') THEN
    RAISE EXCEPTION 'legacy_stage1_missing' USING ERRCODE = '55000';
  END IF;
END $guard$;
DROP POLICY IF EXISTS atokore_photo_read ON storage.objects;
DROP POLICY IF EXISTS atokore_photo_delete ON storage.objects;
COMMIT;
-- Rollback (after review): recreate atokore_photo_read / atokore_photo_delete as in migration
-- 20261024111742_atokore_photo_storage_v44.sql. The bucket itself is kept (deleting it is a separate approval).
