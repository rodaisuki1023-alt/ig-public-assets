-- DRAFT ONLY (v51, A1). Stage 2 of closing the legacy photo bucket. Requires stage 1
-- (atokore-photo-legacy-close-writes-v51.sql). Not applied to any real project; owner approval required.
--
-- Refuses to run while ANY object remains in the legacy bucket. The order this enforces:
--   copy (photo-legacy-migration-rehearsal-v50.mjs) -> separately reviewed CAS switch of the record's
--   photoPath to the gateway bucket -> delete the legacy object through the Storage API (never SQL)
--   -> this file closes client reads and deletes on the legacy bucket.
-- After this file the origin refuses every client request for the legacy bucket. Whether the CDN still
-- answers an earlier URL must be measured on the real project (Free plan has no purge API); until that
-- probe returns no image, the A1 release gate stays FAIL.
BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'atokore-product-photos') THEN
    RAISE EXCEPTION 'legacy_photos_remain' USING ERRCODE = '55000',
      HINT = 'Migrate and delete every legacy object through the Storage API first (see legacy_photo_inventory()).';
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
