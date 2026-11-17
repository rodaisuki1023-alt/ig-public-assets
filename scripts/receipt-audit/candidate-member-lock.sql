-- REVIEW-ONLY, ISOLATED TEST INPUT. NOT A SUPABASE MIGRATION; DO NOT APPLY TO A LIVE DATABASE.
-- Extracted from the v49.1 baseline; only the two membership lookups change to lock_member.

create or replace function public.hh_receipt_claim(p_fingerprint text, p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := atokore_private.require_user();
  v_hh uuid := atokore_private.lock_member(v_user);
  v_row atokore_private.receipt_imports;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint' using errcode = '22023'; end if;
  -- Old records are of no use for duplicate warnings; keep the table small.
  delete from atokore_private.receipt_imports where household_id = v_hh and updated_at < now() - interval '400 days';
  insert into atokore_private.receipt_imports (household_id, fingerprint, state, claimed_by)
  values (v_hh, p_fingerprint, 'pending', v_user)
  on conflict (household_id, fingerprint) do nothing;
  if found then return jsonb_build_object('claimed', true, 'state', 'pending', 'mine', true); end if;
  select * into v_row from atokore_private.receipt_imports
   where household_id = v_hh and fingerprint = p_fingerprint for update;
  if v_row.claimed_by = v_user then
    return jsonb_build_object('claimed', true, 'state', v_row.state, 'mine', true, 'at', v_row.updated_at);
  end if;
  if v_row.state = 'pending' and v_row.updated_at < now() - interval '30 minutes' then
    update atokore_private.receipt_imports set claimed_by = v_user, claimed_at = now(), updated_at = now()
     where household_id = v_hh and fingerprint = p_fingerprint;
    -- The earlier member may still have saved without the record being marked (no connection afterwards):
    -- the caller is told who started it and when, and decides.
    return jsonb_build_object('claimed', true, 'state', 'pending', 'mine', true, 'tookOver', true, 'at', v_row.updated_at,
      'who', (select m.display_name from atokore_private.members m where m.household_id = v_hh and m.user_id = v_row.claimed_by order by m.joined_at desc limit 1));
  end if;
  return jsonb_build_object(
    'claimed', coalesce(p_force, false), 'forced', coalesce(p_force, false), 'state', v_row.state, 'mine', false, 'at', v_row.updated_at,
    'who', (select m.display_name from atokore_private.members m where m.household_id = v_hh and m.user_id = v_row.claimed_by order by m.joined_at desc limit 1));
end $$;

create or replace function public.hh_receipt_finish(p_fingerprint text, p_done boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := atokore_private.require_user();
  v_hh uuid := atokore_private.lock_member(v_user);
  v_n int;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint' using errcode = '22023'; end if;
  if p_done then
    update atokore_private.receipt_imports set state = 'done', updated_at = now()
     where household_id = v_hh and fingerprint = p_fingerprint and claimed_by = v_user;
  else
    delete from atokore_private.receipt_imports
     where household_id = v_hh and fingerprint = p_fingerprint and claimed_by = v_user and state = 'pending';
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end $$;
