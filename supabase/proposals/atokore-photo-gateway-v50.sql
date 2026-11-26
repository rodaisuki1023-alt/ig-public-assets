-- Trial only. Scoped migration for a new, private, non-client-readable
-- bucket and per-request membership authorization RPC.
-- No legacy bucket/policy/table/data changes; no existing photos are modified.
BEGIN;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('atokore-private-photos-v2','atokore-private-photos-v2',false,81920,ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 81920,
  allowed_mime_types = ARRAY['image/jpeg'];

-- There are deliberately NO INSERT, SELECT, UPDATE or DELETE policies on
-- storage.objects for this new bucket. All direct client object access fails.
CREATE OR REPLACE FUNCTION public.hh_photo_access(p_path text, p_operation text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(p_operation IN ('read', 'write', 'delete'), false)
    AND COALESCE(
      p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{8,64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$',
      false
    )
    AND EXISTS (
      SELECT 1
      FROM atokore_private.members m
      JOIN atokore_private.households h
        ON h.id = m.household_id AND h.archived_at IS NULL
      JOIN atokore_private.records r
        ON r.household_id = h.id AND r.kind = 'item' AND r.deleted = false
      WHERE m.user_id = auth.uid() AND m.left_at IS NULL
        AND h.id::text = split_part(p_path, '/', 1)
        AND r.id = split_part(p_path, '/', 2)
        AND (
          p_operation = 'write'
          OR r.fields->>'photoPath' = p_path
        )
    );
$fn$;

REVOKE ALL ON FUNCTION public.hh_photo_access(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_access(text,text) TO authenticated;

COMMIT;
-- Rollback plan (needs separate approval after data review):
-- REVOKE EXECUTE ON FUNCTION public.hh_photo_access(text,text) FROM authenticated;
-- DROP FUNCTION public.hh_photo_access(text,text);
-- Storage bucket deletion only if empty and explicitly approved.
