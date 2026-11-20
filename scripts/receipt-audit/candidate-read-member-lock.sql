-- REVIEW-ONLY: isolated localhost PostgreSQL CI only. DO NOT APPLY TO LIVE SUPABASE.
-- Read RPCs use FOR SHARE membership checks (not exclusive FOR UPDATE) and become VOLATILE.
-- Live changes require separate owner approval, rollback, performance and synthetic user testing.

-- Read-only membership lock: FOR SHARE is compatible with other readers,
-- but conflicts with the household FOR UPDATE held by removal/write RPCs.
-- Recheck membership in a NEW statement after the lock wait (stale JWT safe).
create or replace function atokore_private.read_member(p_user uuid) returns uuid
language plpgsql volatile set search_path = '' as $$
declare v_hh uuid := atokore_private.my_household(p_user);
begin
  if v_hh is not null then
    perform 1 from atokore_private.households where id = v_hh and archived_at is null for share;
    if found then
      perform 1 from atokore_private.members
        where household_id = v_hh and user_id = p_user and left_at is null;
      if found then return v_hh; end if;
    end if;
  end if;
  raise exception 'not_member' using errcode = '42501';
end $$;
revoke all on function atokore_private.read_member(uuid) from public, anon, authenticated;

create or replace function public.hh_pull(p_since bigint default 0, p_limit int default 500) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.read_member(v_user); v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'id', r.id, 'fields', r.fields, 'qty', r.qty, 'deleted', r.deleted, 'seq', r.seq) order by r.seq), '[]'::jsonb)
    into v_rows
    from (select * from atokore_private.records where household_id = v_hh and seq > coalesce(p_since, 0) order by seq limit v_lim + 1) r;
  return jsonb_build_object(
    'records', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_rows) with ordinality t(e, i) where i <= v_lim) s),
    'more', jsonb_array_length(v_rows) > v_lim,
    'cursor', (select coalesce(max((e->>'seq')::bigint), coalesce(p_since, 0)) from (select e from jsonb_array_elements(v_rows) with ordinality t(e, i) where i <= v_lim) s));
end $$;

create or replace function public.hh_changes(p_limit int default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.read_member(v_user);
begin
 if v_hh is null then raise exception 'not_member' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(c order by (c->>'at') desc),'[]'::jsonb) from (
  select jsonb_build_object('at',o.at,'type',o.type,'kind',o.kind,'result',o.result,'record_id',o.record_id,
   'who',(select m.display_name from atokore_private.members m where m.household_id=v_hh and m.user_id=o.actor and m.joined_at<=o.at order by m.joined_at desc limit 1),
   'name',coalesce(o.body->>'_name',(select r.fields->>'name' from atokore_private.records r where r.household_id=v_hh and r.kind=coalesce(o.kind,'buy') and r.id=o.record_id)),
   'unit',coalesce(o.body->>'_unit','個'),'beforeQty',o.body->'_beforeQty','afterQty',o.body->'_afterQty',
   'delta',o.body->'delta','field',o.body->>'field') c
  from atokore_private.ops o where o.household_id=v_hh and o.result like 'applied%'
  order by o.at desc,o.op_id limit least(greatest(coalesce(p_limit,50),1),100)) s);
end $$;
