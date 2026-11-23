-- DRAFT ONLY: intended future migration, NOT applied to any Supabase project.
-- Final migration filename/version must be generated with the reviewed Supabase CLI.
-- Safe rollout requires owner approval, direct URL quarantine and test cohort.
--
-- SECURITY MODEL:
-- * This bucket has NO user-readable/insertable/deletable Storage RLS policies.
-- * ONLY the Edge Function holds privileged credentials for the new bucket.
-- * Clients may call only the boolean RPC hh_photo_access as authenticated.
-- * RPC checks current household membership and an existing, undeleted item.
-- * For read/delete, the current record MUST still reference the exact file.
-- * Do not drop old bucket/policies here: migrate/remove old photos by Storage API
--   and independently test stale CDN URLs before release.

begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('atokore-private-photos-v2','atokore-private-photos-v2',false,81920,array['image/jpeg'])
on conflict (id) do update set
  public=false,
  file_size_limit=81920,
  allowed_mime_types=array['image/jpeg'];

-- Intentionally NO policy for storage.objects bucket_id='atokore-private-photos-v2'
-- Existing storage policies target ONLY the legacy 'atokore-product-photos'.
-- Confirm with pg_policies and direct HTTP GET (A/B/C) before allowing any data.

create or replace function public.hh_photo_access(p_path text,p_operation text)
returns boolean
language sql stable security definer set search_path='' as $fn$
  select
      auth.uid() is not null
      and coalesce(p_operation in ('read','write','delete'),false)
      and coalesce(
        p_path ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{8,64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg,
        false)
      and exists(
        select 1
        from atokore_private.members m
        join atokore_private.households h
          on h.id=m.household_id and h.archived_at is null
        join atokore_private.records r
          on r.household_id=h.id and r.kind='item' and r.deleted=false
        where m.user_id=auth.uid() and m.left_at is null
          and h.id::text=split_part(p_path,'/',1)
          and r.id=split_part(p_path,'/',2)
          and (
            p_operation='write'
            or r.fields->>'photoPath'=p_path
          )
      );
$fn$;

revoke all on function public.hh_photo_access(text,text)
  from public, anon, authenticated;
grant execute on function public.hh_photo_access(text,text) to authenticated;

commit;

-- RELEASE CHECKLIST (read-only before apply and after apply):
--  1) New bucket remains public=false and has zero matching storage.object policies
--     (also check combined policies, not only their names).
--  2) With valid user A/B JWT, direct GET/POST/DELETE on new Storage bucket
--     cannot succeed. Only Edge Function server-side secret client can access.
--  3) Boolean RPC returns true for active member with item (write);
--     read/delete true ONLY when current item.photoPath exactly matches path.
--  4) B removed -> false with old and newly-issued B JWT; C unrelated -> false.
--  5) Existing old bucket has at least one image: DO NOT remove without owner
--     review and documented rollback/new-bucket copy; delete via Storage API.
,
        false)
      and exists(
        select 1
        from atokore_private.members m
        join atokore_private.households h
          on h.id=m.household_id and h.archived_at is null
        join atokore_private.records r
          on r.household_id=h.id and r.kind='item' and r.deleted=false
        where m.user_id=auth.uid() and m.left_at is null
          and h.id::text=split_part(p_path,'/',1)
          and r.id=split_part(p_path,'/',2)
          and (
            p_operation='write'
            or r.fields->>'photoPath'=p_path
          )
      );
$fn$;

revoke all on function public.hh_photo_access(text,text)
  from public, anon, authenticated;
grant execute on function public.hh_photo_access(text,text) to authenticated;

commit;

-- RELEASE CHECKLIST (read-only before apply and after apply):
--  1) New bucket remains public=false and has zero matching storage.object policies
--     (also check combined policies, not only their names).
--  2) With valid user A/B JWT, direct GET/POST/DELETE on new Storage bucket
--     cannot succeed. Only Edge Function server-side secret client can access.
--  3) Boolean RPC returns true for active member with item (write);
--     read/delete true ONLY when current item.photoPath exactly matches path.
--  4) B removed -> false with old and newly-issued B JWT; C unrelated -> false.
--  5) Existing old bucket has at least one image: DO NOT remove without owner
--     review and documented rollback/new-bucket copy; delete via Storage API.
