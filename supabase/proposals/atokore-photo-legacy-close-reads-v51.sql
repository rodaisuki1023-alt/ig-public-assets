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
--   * no unfinished legacy move (atokore-photo-legacy-migrate-v51.sql; verified-but-not-deleted counts),
--   * ledger, references and objects agree: each attached row has its live record pointing at it,
--     its object in the managed bucket, and the hash and size the general gateway checks,
--   * every attached photo was read like the gateway reads it, with that hash, and the read is of the
--     object generation that is there now (read checks; Work 6th: same-path overwrite after a check),
--   * stage 1 already applied,
--   * (Work 7th) the real Storage guarantees were proven and recorded (photo_storage_guarantees_v51), no
--     delete is still undecided, and every attached photo was read within the last 10 minutes,
--   * (Work 8th) that proof is bound to this project/environment/cluster, the current write configuration
--     and photo snapshot, unexpired (<= 24 h) and not revoked; and the environment is synthetic. On any
--     other environment this draft refuses (operational_close_off).
-- Two people running this at once: the advisory lock serializes them, and the second one finds the
-- read policy already gone and changes nothing. A record write or a legacy move commit that runs at the
-- same time waits for this transaction (or this one waits for it) because of the SHARE locks.
SELECT pg_advisory_xact_lock(hashtext('atokore_legacy_photo_close_v51'));
LOCK TABLE atokore_private.records IN SHARE MODE;
LOCK TABLE storage.objects IN SHARE MODE;
LOCK TABLE atokore_private.photo_ledger_v50 IN SHARE MODE;
LOCK TABLE atokore_private.photo_read_checks_v51 IN SHARE MODE;
LOCK TABLE atokore_private.photo_legacy_moves_v51 IN SHARE MODE;
DO $guard$
BEGIN
  -- Already closed (a second operator, or a rerun): nothing left to close, nothing changes. Checked first
  -- because closing itself changes the write configuration a proof is bound to.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname IN ('atokore_photo_read','atokore_photo_delete')) THEN
    RETURN;
  END IF;
  IF to_regclass('atokore_private.photo_ledger_v50') IS NULL OR to_regclass('atokore_private.photo_legacy_moves_v51') IS NULL
     OR to_regclass('atokore_private.photo_read_checks_v51') IS NULL THEN
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
  IF EXISTS (SELECT 1 FROM atokore_private.photo_legacy_moves_v51 WHERE state IN ('copying','switched','verified')) THEN
    RAISE EXCEPTION 'legacy_migration_unfinished' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM atokore_private.photo_ledger_v50 l
             WHERE l.state = 'attached' AND (
               NOT EXISTS (SELECT 1 FROM atokore_private.records r WHERE r.household_id = l.household_id AND r.kind = 'item'
                           AND r.id = l.record_id AND NOT r.deleted AND r.fields->>'photoPath' = atokore_private.photo_object_path_v50(l))
               OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'atokore-private-photos-v2'
                              AND o.name = atokore_private.photo_object_path_v50(l))
               OR l.upload_sha256 IS NULL OR l.actual_bytes IS NULL)) THEN
    RAISE EXCEPTION 'photo_ledger_inconsistent' USING ERRCODE = '55000';
  END IF;
  -- Every attached photo was READ the way the general gateway reads it (atokore-photo-legacy-migrate-v51
  -- read checks: authorization, size, SHA-256, JPEG) after its object was written, with the hash and
  -- size the ledger holds. One photo that nobody could read is enough to refuse.
  IF EXISTS (SELECT 1 FROM atokore_private.photo_ledger_v50 l
             LEFT JOIN atokore_private.photo_read_checks_v51 c ON c.file_id = l.file_id
             LEFT JOIN storage.objects o ON o.bucket_id = 'atokore-private-photos-v2' AND o.name = atokore_private.photo_object_path_v50(l)
             WHERE l.state = 'attached' AND (c.file_id IS NULL OR c.sha256 IS DISTINCT FROM l.upload_sha256
               OR c.bytes IS DISTINCT FROM l.actual_bytes OR c.checked_at < o.created_at
               -- the read was of THIS object generation; any write at that path since (other bytes, an
               -- outside operation, an unknown state) makes it count as unread
               OR c.gen IS NULL OR c.gen IS DISTINCT FROM atokore_private.photo_object_gen_v51('atokore-private-photos-v2', atokore_private.photo_object_path_v50(l)))) THEN
    RAISE EXCEPTION 'photo_unread_remain' USING ERRCODE = '55000',
      HINT = 'Run the read checks (runReadChecks) and fix every photo that cannot be read before closing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'atokore_photo_insert') THEN
    RAISE EXCEPTION 'legacy_stage1_missing' USING ERRCODE = '55000';
  END IF;
  -- Work 7th/8th (last, after every specific check): never closed on database metadata alone.
  -- Operational close is OFF: outside an isolated synthetic environment this draft always refuses, whatever
  -- any row says (a real close needs its own reviewed draft and a real Storage adapter that can prove it).
  IF to_regclass('atokore_private.photo_environment_v51') IS NULL OR NOT EXISTS (SELECT 1 FROM atokore_private.photo_environment_v51) THEN
    RAISE EXCEPTION 'environment_unknown' USING ERRCODE = '55000';
  END IF;
  IF NOT atokore_private.photo_environment_synthetic_v51() THEN
    RAISE EXCEPTION 'operational_close_off' USING ERRCODE = '55000',
      HINT = 'Closing the legacy bucket on a real project is not available in these drafts.';
  END IF;
  -- The proof must be bound to this project, environment and cluster, cover every photo bucket, match the
  -- write configuration and photo snapshot as they are NOW, be issued for at most 24 hours, unexpired and
  -- not revoked. A proof from an old or another environment, or one made before a policy change or an
  -- object write, does not count.
  IF to_regclass('atokore_private.photo_storage_guarantees_v51') IS NULL OR NOT EXISTS (
       SELECT 1 FROM atokore_private.photo_storage_guarantees_v51 g, atokore_private.photo_environment_v51 e
        WHERE g.generation_proven AND g.writes_fenced AND g.gateway_http_proven
          AND g.project_ref = e.project_ref AND g.environment = e.environment
          AND g.cluster_id = atokore_private.photo_cluster_id_v51()
          AND g.buckets @> ARRAY['atokore-product-photos','atokore-private-photos-v2','atokore-photo-backup-v51']
          AND g.write_config_version = atokore_private.photo_write_config_version_v51()
          AND g.snapshot_hash = atokore_private.photo_snapshot_v51()
          AND g.issued_at <= clock_timestamp() AND g.expires_at > clock_timestamp()
          AND g.expires_at - g.issued_at <= interval '24 hours'
          AND g.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'storage_guarantee_unproven' USING ERRCODE = '55000',
      HINT = 'No proof bound to this environment, write configuration and photo snapshot (unexpired, not revoked).';
  END IF;
  -- No delete that is still undecided (a lost or unclear answer leaves its key fenced and pending).
  IF to_regclass('atokore_private.photo_delete_intents_v51') IS NOT NULL
     AND EXISTS (SELECT 1 FROM atokore_private.photo_delete_intents_v51 WHERE state = 'pending') THEN
    RAISE EXCEPTION 'photo_delete_pending' USING ERRCODE = '55000';
  END IF;
  -- Every attached photo was read within the last 10 minutes (not just once, long ago).
  IF EXISTS (SELECT 1 FROM atokore_private.photo_ledger_v50 l LEFT JOIN atokore_private.photo_read_checks_v51 c ON c.file_id = l.file_id
             WHERE l.state = 'attached' AND (c.file_id IS NULL OR c.checked_at < clock_timestamp() - interval '10 minutes')) THEN
    RAISE EXCEPTION 'photo_unread_remain' USING ERRCODE = '55000', HINT = 'Run the read checks again right before closing.';
  END IF;
END $guard$;
DROP POLICY IF EXISTS atokore_photo_read ON storage.objects;
DROP POLICY IF EXISTS atokore_photo_delete ON storage.objects;
COMMIT;
-- Rollback (after review): recreate atokore_photo_read / atokore_photo_delete as in migration
-- 20261024111742_atokore_photo_storage_v44.sql. The bucket itself is kept (deleting it is a separate approval).
