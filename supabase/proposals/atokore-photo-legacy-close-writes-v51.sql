-- DRAFT ONLY (v51, A1 旧URL問題). Stage 1 of closing the legacy photo bucket 'atokore-product-photos'.
-- Not applied to any real project. Apply only with owner approval, after the reviewed photo gateway is
-- live for every client (photoGatewayEnabled) and after a fresh read-only look at the real project.
--
-- Why staged: the old bucket was served through Supabase Storage URLs, and the trial showed the CDN
-- returning a removed member's earlier URL (HIT/200). A policy change cannot purge that cache. What can
-- be done in SQL is (1) stop every client from creating new legacy objects, (2) list exactly which
-- legacy objects are still referenced so each one is copied, switched and then deleted through the
-- Storage API by a separately approved worker, and (3) only when the bucket is empty, close client
-- reads and deletes (stage 2, atokore-photo-legacy-close-reads-v51.sql).
--   * Nothing here deletes an object, a record or a photo path. No data is moved.
--   * Members keep seeing existing legacy photos until each is migrated (no sudden blank photos).
--   * photo_allowed() still re-checks active membership on every origin request, so a member who left
--     is denied by the origin today; the CDN copy is the open problem and is not solved by this file.
BEGIN;

-- Old app versions (or a copied URL) can no longer add objects to the legacy bucket.
DROP POLICY IF EXISTS atokore_photo_insert ON storage.objects;

-- Service-only inventory for the migration worker: every legacy object, and whether a live item still
-- points at it. referenced=true -> copy + switch first; referenced=false -> orphan, delete after review.
CREATE FUNCTION atokore_private.legacy_photo_inventory()
RETURNS TABLE(household_id uuid, record_id text, path text, referenced boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT CASE WHEN o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' THEN split_part(o.name, '/', 1)::uuid END,
         split_part(o.name, '/', 2),
         o.name,
         EXISTS (SELECT 1 FROM atokore_private.records r
                 WHERE r.household_id::text = split_part(o.name, '/', 1) AND r.kind = 'item' AND r.id = split_part(o.name, '/', 2)
                   AND NOT r.deleted AND r.fields->>'photoPath' = o.name)
  FROM storage.objects o
  WHERE o.bucket_id = 'atokore-product-photos'
  ORDER BY o.name
$fn$;
REVOKE ALL ON FUNCTION atokore_private.legacy_photo_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atokore_private.legacy_photo_inventory() TO service_role;
COMMIT;
-- Rollback (after review): recreate atokore_photo_insert exactly as in migration
-- 20261024111742_atokore_photo_storage_v44.sql and drop legacy_photo_inventory().
