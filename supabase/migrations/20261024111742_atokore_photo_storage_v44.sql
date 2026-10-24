-- Small JPEGs, private to active household members. Existing local photos are never auto-uploaded.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('atokore-product-photos','atokore-product-photos',false,81920,array['image/jpeg'])
 on conflict(id) do update set public=false,file_size_limit=81920,allowed_mime_types=array['image/jpeg'];

create or replace function atokore_private.photo_allowed(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}/[0-9a-f-]{36}\.jpg$'
 and exists(select 1 from atokore_private.members m
   join atokore_private.households h on h.id=m.household_id and h.archived_at is null
   join atokore_private.records r on r.household_id=h.id and r.kind='item' and not r.deleted
   where m.user_id=auth.uid() and m.left_at is null
   and h.id::text=split_part(p_name,'/',1) and r.id=split_part(p_name,'/',2))
$$;
revoke all on function atokore_private.photo_allowed(text) from public,anon;
grant usage on schema atokore_private to authenticated;
grant execute on function atokore_private.photo_allowed(text) to authenticated;

create policy atokore_photo_read on storage.objects for select to authenticated
 using(bucket_id='atokore-product-photos' and atokore_private.photo_allowed(name));
create policy atokore_photo_insert on storage.objects for insert to authenticated
 with check(bucket_id='atokore-product-photos' and atokore_private.photo_allowed(name));
create policy atokore_photo_delete on storage.objects for delete to authenticated
 using(bucket_id='atokore-product-photos' and atokore_private.photo_allowed(name));
-- Immutable object names: replacement is a new JPEG and a normal synchronized photoPath field.
