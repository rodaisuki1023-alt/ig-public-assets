-- Guest users may redeem an invitation, but cannot create an unrecoverable household.
-- Keep the existing private tables, RPC permissions and per-user locking unchanged.
create or replace function public.hh_create(p_name text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'permanent_account_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if atokore_private.my_household(v_user) is not null then raise exception 'already_member' using errcode = '23505'; end if;
  insert into atokore_private.households (name, created_by) values (atokore_private.clean_name(coalesce(nullif(btrim(p_name), ''), 'わが家'), 40), v_user)
    returning id into v_hh;
  insert into atokore_private.members (household_id, user_id, role, display_name)
    values (v_hh, v_user, 'owner', atokore_private.clean_name(p_display_name, 20));
  return atokore_private.household_json(v_hh, v_user);
end $$;
