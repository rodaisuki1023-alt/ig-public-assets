-- Atokore v49: one record per receipt imported by a household, so the family is warned before the same
-- receipt is added to stock twice (two phones, a re-shot photo, a retry after going offline).
-- NOT APPLIED to any real database by this change: see docs/atokore-receipt-family-duplicates-v49.md.
--
-- Only a SHA-256 fingerprint is stored (computed on the phone from the store's registration number or
-- phone, the printed date and time, the total and the receipt number, or from the photo bytes): no
-- product, price, member or payment information is sent or kept.
-- Additive only: a new table and three functions. No existing table, row or function is changed.

create table if not exists atokore_private.receipt_imports (
  household_id uuid not null references atokore_private.households(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'done')),
  claimed_by uuid not null,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, fingerprint)
);
revoke all on table atokore_private.receipt_imports from public;

-- Reserve a receipt before saving. The primary key makes this atomic: when two phones claim the same
-- fingerprint at the same time, exactly one gets claimed=true.
--   claimed=true            → nobody else has it (or it is the caller's own, or an abandoned reservation
--                              older than 30 minutes): go ahead.
--   claimed=false, state     → another member has it ('pending' = in progress, 'done' = imported), with
--                              their display name and time; the phone asks the person before going ahead.
-- p_force=true (the person chose "a different purchase") never changes the existing record.
create or replace function public.hh_receipt_claim(p_fingerprint text, p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := atokore_private.require_user();
  v_hh uuid := atokore_private.my_household(v_user);
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

-- After saving (p_done=true) the reservation becomes 'done'; when the person gave up (p_done=false) the
-- caller's own pending reservation is removed. Another member's record is never changed.
create or replace function public.hh_receipt_finish(p_fingerprint text, p_done boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := atokore_private.require_user();
  v_hh uuid := atokore_private.my_household(v_user);
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

revoke all on function public.hh_receipt_claim(text, boolean) from public, anon;
revoke all on function public.hh_receipt_finish(text, boolean) from public, anon;
grant execute on function public.hh_receipt_claim(text, boolean) to authenticated;
grant execute on function public.hh_receipt_finish(text, boolean) to authenticated;
