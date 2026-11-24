-- DRAFT follow-up to applied trial migration 20261123171254.
-- Not applied. Restrict the existing photo RPC to one new synthetic cohort.
-- Does not modify real data, tables, buckets, existing policies, or other RPCs.
-- Requires separate explicit authorization for application to trial.
BEGIN;
CREATE OR REPLACE FUNCTION public.hh_photo_access(p_path text, p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE(
    auth.uid() IS NOT NULL
    AND p_operation IN ('read', 'write', 'delete')
    AND p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/qa_f8a63d1e92_item/5ca20f26-739f-4c19-8a75-56e09319af82[.]jpg$'
    AND EXISTS (
      SELECT 1 FROM auth.sessions s
      WHERE s.user_id = auth.uid()
        AND s.id::text = auth.jwt()->>'session_id'
        AND (s.not_after IS NULL OR s.not_after > now())
    )
    AND EXISTS (
      SELECT 1 FROM atokore_private.members m
      JOIN auth.users u ON u.id = m.user_id AND u.email_confirmed_at IS NOT NULL
      JOIN atokore_private.households h ON h.id = m.household_id AND h.archived_at IS NULL
      JOIN auth.users owner ON owner.id = h.created_by
      JOIN atokore_private.records r ON r.household_id = h.id AND r.kind = 'item' AND r.deleted = false
      WHERE m.user_id = auth.uid() AND m.left_at IS NULL
        AND u.email IN ('atokore-qa-a-f8a63d1e92@example.invalid','atokore-qa-b-f8a63d1e92@example.invalid','atokore-qa-c-f8a63d1e92@example.invalid')
        AND owner.email = 'atokore-qa-a-f8a63d1e92@example.invalid'
        AND owner.email_confirmed_at IS NOT NULL
        AND h.name = 'ATK-QA-f8a63d1e92-A'
        AND h.id::text = split_part(p_path, '/', 1)
        AND r.id = split_part(p_path, '/', 2)
        AND (
          (p_operation = 'read' AND r.fields->>'photoPath' = p_path)
          OR (p_operation = 'write' AND u.id = h.created_by AND NULLIF(r.fields->>'photoPath','') IS NULL)
          OR (p_operation = 'delete' AND u.id = h.created_by AND r.fields->>'photoPath' = p_path)
        )
    ),false);
$fn$;
REVOKE ALL ON FUNCTION public.hh_photo_access(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hh_photo_access(text,text) TO authenticated;
COMMIT;
-- Server must independently match explicitly approved user UUIDs.
-- This is not a general production authorization or quota implementation.
-- The fixed object path plus upsert:false prevents repeated writes to the
-- same test path. Production requires separate reservation/lifecycle design.
