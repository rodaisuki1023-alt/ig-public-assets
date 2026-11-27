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
-- Work 7th (P0): the database's object metadata is not proof of the bytes. Stage 2 (closing reads) also
-- requires a record that the REAL Storage behaviour was proven on the project, separately approved:
--   generation_proven  — every overwrite changes the generation the database sees, before reads see the bytes,
--   writes_fenced      — no writer outside these drafts (service role, dashboard, other functions) can
--                        write the managed or legacy bucket from stage 2 on,
--   gateway_http_proven — the general gateway answered real HTTP reads with the recorded bytes,
-- with the evidence. Until that record exists (it is never created by these drafts), closing is refused.
-- The identity of the environment these drafts run in. Never filled by the drafts; an isolated test
-- writes 'synthetic'. Stage 2 refuses every environment except synthetic (operational close is OFF).
CREATE TABLE IF NOT EXISTS atokore_private.photo_environment_v51 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  project_ref text NOT NULL CHECK (char_length(project_ref) BETWEEN 3 AND 80),
  environment text NOT NULL CHECK (environment IN ('synthetic','trial','production')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atokore_private.photo_environment_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_environment_v51 FROM PUBLIC, anon, authenticated;
-- Work 8th (B): what a proof is bound to. Each is recomputed at close time and compared.
CREATE OR REPLACE FUNCTION atokore_private.photo_cluster_id_v51() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT system_identifier::text FROM pg_catalog.pg_control_system() $$;
-- Write paths: every policy on storage.objects and every photo bucket's settings. A new or changed
-- policy (another writer), a bucket made public or a changed limit gives another version.
CREATE OR REPLACE FUNCTION atokore_private.photo_write_config_version_v51() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT md5(
  coalesce((SELECT string_agg(p.policyname||'|'||p.permissive||'|'||p.cmd||'|'||p.roles::text||'|'||coalesce(p.qual,'')||'|'||coalesce(p.with_check,''),E'\n' ORDER BY p.policyname)
            FROM pg_catalog.pg_policies p WHERE p.schemaname='storage' AND p.tablename='objects'),'')
  ||'#'||coalesce((SELECT string_agg(b.id||'|'||coalesce(b.public::text,'')||'|'||coalesce(b.file_size_limit::text,'')||'|'||coalesce(b.allowed_mime_types::text,''),E'\n' ORDER BY b.id)
            FROM storage.buckets b WHERE b.id IN ('atokore-product-photos','atokore-private-photos-v2','atokore-photo-backup-v51')),'')) $$;
-- The photos the proof was made on: every attached photo with its hash, size and object generation, and
-- the legacy objects still there. Any write at a path (a new generation) gives another snapshot.
CREATE OR REPLACE FUNCTION atokore_private.photo_snapshot_v51() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
-- plpgsql: stage 1 may be applied before the v50 ledger exists; the body is resolved when called.
AS $$ BEGIN RETURN md5(
  coalesce((SELECT string_agg(l.file_id::text||'|'||coalesce(l.upload_sha256,'')||'|'||coalesce(l.actual_bytes::text,'')||'|'
             ||coalesce((SELECT md5(o.id::text||'|'||coalesce(o.updated_at::text,'')||'|'||coalesce(o.metadata->>'eTag','')||'|'||coalesce(o.metadata->>'size',''))
                         FROM storage.objects o WHERE o.bucket_id='atokore-private-photos-v2' AND o.name=atokore_private.photo_object_path_v50(l)),''),E'\n' ORDER BY l.file_id)
            FROM atokore_private.photo_ledger_v50 l WHERE l.state='attached'),'')
  ||'#'||coalesce((SELECT string_agg(o.name||'|'||o.id::text||'|'||coalesce(o.updated_at::text,''),E'\n' ORDER BY o.name)
            FROM storage.objects o WHERE o.bucket_id='atokore-product-photos'),'')); END $$;
-- Synthetic only: the environment record says synthetic AND this is not a Supabase-managed cluster
-- (a real project has the supabase_admin / supabase_storage_admin roles, so a row claiming 'synthetic'
-- there is still refused).
CREATE OR REPLACE FUNCTION atokore_private.photo_environment_synthetic_v51() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS(SELECT 1 FROM atokore_private.photo_environment_v51 e WHERE e.environment='synthetic')
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('supabase_admin','supabase_storage_admin')) $$;
REVOKE ALL ON FUNCTION atokore_private.photo_cluster_id_v51(), atokore_private.photo_write_config_version_v51(),
  atokore_private.photo_snapshot_v51(), atokore_private.photo_environment_synthetic_v51() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atokore_private.photo_cluster_id_v51(), atokore_private.photo_write_config_version_v51(),
  atokore_private.photo_snapshot_v51(), atokore_private.photo_environment_synthetic_v51() TO service_role;
CREATE TABLE IF NOT EXISTS atokore_private.photo_storage_guarantees_v51 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation_proven boolean NOT NULL DEFAULT false,
  writes_fenced boolean NOT NULL DEFAULT false,
  gateway_http_proven boolean NOT NULL DEFAULT false,
  evidence text NOT NULL CHECK (char_length(evidence) BETWEEN 20 AND 2000),
  approved_by text NOT NULL CHECK (char_length(approved_by) BETWEEN 1 AND 80),
  proven_at timestamptz NOT NULL DEFAULT now(),
  -- Work 8th (B): three booleans from an old or another environment closed the bucket. A proof now only
  -- counts bound to WHERE and WHAT it was proven on (all checked by the stage-2 guard; NULL never counts):
  project_ref text,                 -- the project the proof was made on (must match photo_environment_v51)
  environment text,                 -- synthetic / trial / production (must match, and must be synthetic)
  cluster_id text DEFAULT atokore_private.photo_cluster_id_v51(),  -- this database cluster; a copied row keeps its source's
  buckets text[],                   -- every bucket the proof covers (managed, legacy, backup)
  write_config_version text,        -- photo_write_config_version_v51() when proven (policies + bucket settings)
  snapshot_hash text,               -- photo_snapshot_v51() when proven (attached photos and their generations)
  issued_at timestamptz,
  expires_at timestamptz,           -- at most 24 hours after issued_at
  revoked_at timestamptz            -- any value revokes
);
ALTER TABLE atokore_private.photo_storage_guarantees_v51 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atokore_private.photo_storage_guarantees_v51 FROM PUBLIC, anon, authenticated;
COMMIT;
-- Rollback (after review): recreate atokore_photo_insert exactly as in migration
-- 20261024111742_atokore_photo_storage_v44.sql and drop legacy_photo_inventory().
