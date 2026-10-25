-- W2 item 6: history entries can be opened and name the right person.
-- * record_id lets the app open the current product (or say it was deleted).
-- * who is the name the member had in the membership period of the change (a later re-join under
--   another name does not relabel old records); null when the actor cannot be identified, so the app
--   shows "実行者不明" instead of guessing "家族".
create or replace function public.hh_changes(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
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
revoke all on function public.hh_changes(int) from public, anon;
grant execute on function public.hh_changes(int) to authenticated;
