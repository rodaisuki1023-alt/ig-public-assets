-- Atokore household plans and usage counting (trial project only).
-- PREPARATION ONLY: no payment provider is connected and nothing here sells anything. The client
-- cannot change a plan: plans change only through apply_contract_event, which only the server
-- (a future payment webhook running with the service role) may call.
-- Rules:
--  * A plan belongs to the household, never to one person; every member gets the same plan.
--  * Cancelling or expiring never deletes data and never removes members: the household falls back
--    to the free limits, and only new invites beyond the free seats are refused.
--  * Usage is counted once per (household, feature, event key): retries and double taps count once,
--    and counting is serialized per household, so two devices cannot both use the last unit.
--  * Only features that cost money on the server are counted. Reading receipts on the phone costs
--    nothing and is not counted (the browser could not be trusted to report it anyway).
-- Design: docs/atokore-plans-v39.md

create table atokore_private.contracts (
  household_id uuid primary key references atokore_private.households(id),
  provider text not null check (provider in ('app_store', 'google_play', 'stripe', 'manual')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  status text not null check (status in ('active', 'grace', 'cancelled', 'expired', 'refunded')),
  current_period_end timestamptz,
  last_event_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

-- Every payment event ever received (idempotency: the same event is applied once).
create table atokore_private.contract_events (
  provider text not null,
  event_id text not null check (char_length(event_id) between 1 and 200),
  household_id uuid,
  received_at timestamptz not null default now(),
  body jsonb not null default '{}'::jsonb,
  result text not null,
  primary key (provider, event_id)
);

create table atokore_private.usage (
  household_id uuid not null references atokore_private.households(id),
  feature text not null,
  event_key text not null check (event_key ~ '^[A-Za-z0-9_.:-]{8,80}$'),
  period date not null,
  actor uuid,
  at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  primary key (household_id, feature, event_key)
);
create index usage_household_period on atokore_private.usage (household_id, feature, period);

alter table atokore_private.contracts enable row level security;
alter table atokore_private.contract_events enable row level security;
alter table atokore_private.usage enable row level security;

-- ---------------------------------------------------------------- helpers (not callable by clients)

-- Limits per plan. Only numbers enforced on the server live here.
create or replace function atokore_private.plan_limits(p_plan text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_plan
    when 'premium' then '{"seats": 6, "server_receipt_reads": 30}'::jsonb
    else '{"seats": 2, "server_receipt_reads": 3}'::jsonb
  end
$$;

create or replace function atokore_private.effective_plan(p_hh uuid) returns text
language sql stable set search_path = '' as $$
  select case when h.plan = 'premium' and (h.plan_expires_at is null or h.plan_expires_at > now()) then 'premium' else 'free' end
  from atokore_private.households h where h.id = p_hh
$$;

-- Replaces the base version: the plan's seats, never fewer than the household's own setting.
create or replace function atokore_private.seat_limit(p_hh uuid) returns int
language sql stable set search_path = '' as $$
  select greatest(h.seat_limit, (atokore_private.plan_limits(atokore_private.effective_plan(h.id))->>'seats')::int)
  from atokore_private.households h where h.id = p_hh
$$;

-- Usage periods are calendar months in Japan time.
create or replace function atokore_private.usage_period(p_at timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', p_at at time zone 'Asia/Tokyo')::date
$$;

create or replace function atokore_private.used(p_hh uuid, p_feature text) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from atokore_private.usage u
  where u.household_id = p_hh and u.feature = p_feature and u.period = atokore_private.usage_period(now()) and u.released_at is null
$$;

-- Counts one use of a paid server feature. Idempotent per event key; serialized per household.
create or replace function atokore_private.consume(p_hh uuid, p_actor uuid, p_feature text, p_event_key text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_limit int; v_used int; v_row atokore_private.usage%rowtype;
begin
  v_limit := (atokore_private.plan_limits('free')->>p_feature)::int;
  if p_feature = 'seats' or v_limit is null then return jsonb_build_object('status', 'rejected:unknown_feature'); end if;
  if p_event_key is null or p_event_key !~ '^[A-Za-z0-9_.:-]{8,80}$' then return jsonb_build_object('status', 'rejected:bad_event_key'); end if;
  perform 1 from atokore_private.households where id = p_hh for update;
  v_limit := (atokore_private.plan_limits(atokore_private.effective_plan(p_hh))->>p_feature)::int;
  select * into v_row from atokore_private.usage where household_id = p_hh and feature = p_feature and event_key = p_event_key;
  if found then
    return jsonb_build_object('status', 'duplicate', 'counted', v_row.released_at is null,
      'used', atokore_private.used(p_hh, p_feature), 'limit', v_limit);
  end if;
  v_used := atokore_private.used(p_hh, p_feature);
  if v_used >= v_limit then
    return jsonb_build_object('status', 'limit_reached', 'used', v_used, 'limit', v_limit);
  end if;
  insert into atokore_private.usage (household_id, feature, event_key, period, actor)
    values (p_hh, p_feature, p_event_key, atokore_private.usage_period(now()), p_actor);
  return jsonb_build_object('status', 'counted', 'used', v_used + 1, 'limit', v_limit);
end $$;

-- A server-side read that failed (provider error, timeout, no text found) is given back.
-- Server only: a client could otherwise give back reads that did work.
create or replace function atokore_private.release(p_hh uuid, p_feature text, p_event_key text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_reason not in ('provider_error', 'timeout', 'no_text') then return 'rejected:bad_reason'; end if;
  update atokore_private.usage set released_at = now(), release_reason = p_reason
    where household_id = p_hh and feature = p_feature and event_key = p_event_key and released_at is null and at > now() - interval '1 hour';
  get diagnostics n = row_count;
  return case when n = 1 then 'released' else 'not_found' end;
end $$;

-- Applies one payment-provider event (server only). Idempotent per event id; an event older than
-- the last applied one for the same contract is recorded but changes nothing (providers retry and
-- reorder). Never deletes data and never removes members.
create or replace function atokore_private.apply_contract_event(
  p_provider text, p_event_id text, p_external_id text, p_household uuid,
  p_status text, p_period_end timestamptz, p_event_at timestamptz, p_body jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_result text; v_contract atokore_private.contracts%rowtype; n int;
begin
  insert into atokore_private.contract_events (provider, event_id, household_id, body, result)
    values (p_provider, p_event_id, p_household, coalesce(p_body, '{}'::jsonb), 'pending')
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;
  perform 1 from atokore_private.households where id = p_household for update;
  if not found or p_status not in ('active', 'grace', 'cancelled', 'expired', 'refunded') or p_event_at is null then
    v_result := 'rejected';
  else
    select * into v_contract from atokore_private.contracts where household_id = p_household for update;
    if found and (v_contract.provider <> p_provider or v_contract.external_id <> p_external_id) and v_contract.status in ('active', 'grace')
       and (v_contract.current_period_end is null or v_contract.current_period_end > now()) then
      v_result := 'rejected:other_active_contract';
    elsif found and v_contract.last_event_at > p_event_at then
      v_result := 'stale';
    else
      insert into atokore_private.contracts (household_id, provider, external_id, status, current_period_end, last_event_at)
        values (p_household, p_provider, p_external_id, p_status, p_period_end, p_event_at)
        on conflict (household_id) do update set provider = excluded.provider, external_id = excluded.external_id,
          status = excluded.status, current_period_end = excluded.current_period_end, last_event_at = excluded.last_event_at, updated_at = now();
      -- Cancelled keeps the paid period that was already paid for; expired or refunded ends it now.
      update atokore_private.households set
        plan = case when p_status in ('active', 'grace', 'cancelled') then 'premium' else 'free' end,
        plan_expires_at = case when p_status in ('active', 'grace', 'cancelled') then p_period_end else now() end
        where id = p_household;
      v_result := 'applied';
    end if;
  end if;
  update atokore_private.contract_events set result = v_result where provider = p_provider and event_id = p_event_id;
  return v_result;
end $$;

-- ---------------------------------------------------------------- client API (RPC)

-- What this household may use and has used this month. Read-only; any member may look.
create or replace function public.hh_entitlements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); v_plan text;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  v_plan := atokore_private.effective_plan(v_hh);
  return jsonb_build_object(
    'plan', v_plan,
    'premium_until', (select case when v_plan = 'premium' then h.plan_expires_at end from atokore_private.households h where h.id = v_hh),
    'limits', atokore_private.plan_limits(v_plan) || jsonb_build_object('seats', atokore_private.seat_limit(v_hh)),
    'period', atokore_private.usage_period(now()),
    'usage', jsonb_build_object('server_receipt_reads', atokore_private.used(v_hh, 'server_receipt_reads')),
    'seats_used', (select count(*) from atokore_private.members m where m.household_id = v_hh and m.left_at is null));
end $$;

-- Counts one use for the caller's own household (for the future server-side reader, which calls it
-- with the person's session before doing paid work). Calling it can only spend one's own quota.
create or replace function public.hh_consume(p_feature text, p_event_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  return atokore_private.consume(v_hh, v_user, p_feature, p_event_key);
end $$;

do $$
declare f text;
begin
  foreach f in array array['hh_entitlements()', 'hh_consume(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema atokore_private from public;
-- The payment webhook and the server-side reader run with Supabase's service role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema atokore_private to service_role;
    grant execute on function atokore_private.apply_contract_event(text, text, text, uuid, text, timestamptz, timestamptz, jsonb) to service_role;
    grant execute on function atokore_private.release(uuid, text, text, text) to service_role;
  end if;
end $$;
