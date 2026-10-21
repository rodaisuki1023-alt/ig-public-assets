-- Atokore household sharing (trial project only; never the production app's data).
-- Clients cannot read or write these tables directly: RLS is enabled with no policies and the
-- private schema is not exposed. Every access goes through the SECURITY DEFINER functions below,
-- which check that auth.uid() is an active member of the household they touch.
-- Design: docs/atokore-household-sharing-v37-design.md

create schema if not exists atokore_private;
revoke all on schema atokore_private from public;

create table atokore_private.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  plan_expires_at timestamptz,
  seat_limit int not null default 2 check (seat_limit between 1 and 10),
  record_limit int not null default 3000 check (record_limit > 0)
);

-- One row per membership period, so leaving and joining again keeps the history.
create table atokore_private.members (
  household_id uuid not null references atokore_private.households(id),
  user_id uuid not null,
  role text not null check (role in ('owner', 'member')),
  display_name text not null check (char_length(display_name) between 1 and 20),
  joined_at timestamptz not null default clock_timestamp(),
  left_at timestamptz,
  primary key (household_id, user_id, joined_at)
);
-- A person belongs to at most one household at a time (their other devices are not members).
create unique index members_one_active_household on atokore_private.members (user_id) where left_at is null;

-- Only a hash of each invite code is stored; codes are single use and expire.
create table atokore_private.invites (
  code_hash text primary key,
  household_id uuid not null references atokore_private.households(id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid,
  used_at timestamptz,
  revoked_at timestamptz
);

create table atokore_private.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index join_attempts_user_at on atokore_private.join_attempts (user_id, at);

create sequence atokore_private.change_seq;

-- Shared stock, shopping and recurring-list records. qty is a counter changed only by deltas;
-- every other field is last-writer-wins per field (clocks); deleted records stay as tombstones.
create table atokore_private.records (
  household_id uuid not null references atokore_private.households(id),
  kind text not null check (kind in ('item', 'buy', 'routine')),
  id text not null check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  fields jsonb not null default '{}'::jsonb,
  clocks jsonb not null default '{}'::jsonb,
  qty numeric not null default 0 check (qty >= 0),
  deleted boolean not null default false,
  seq bigint not null,
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (household_id, kind, id)
);
create index records_household_seq on atokore_private.records (household_id, seq);

-- Every operation ever received: idempotency (the same op_id is applied once) and change history.
create table atokore_private.ops (
  household_id uuid not null references atokore_private.households(id),
  op_id uuid not null,
  actor uuid not null,
  device text,
  at timestamptz not null default now(),
  type text not null,
  kind text,
  record_id text,
  body jsonb not null,
  result text not null,
  primary key (household_id, op_id)
);
create index ops_household_at on atokore_private.ops (household_id, at desc);

alter table atokore_private.households enable row level security;
alter table atokore_private.members enable row level security;
alter table atokore_private.invites enable row level security;
alter table atokore_private.join_attempts enable row level security;
alter table atokore_private.records enable row level security;
alter table atokore_private.ops enable row level security;

-- ---------------------------------------------------------------- helpers (not callable by clients)

create or replace function atokore_private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function atokore_private.my_household(p_user uuid) returns uuid
language sql stable set search_path = '' as $$
  select m.household_id from atokore_private.members m
  join atokore_private.households h on h.id = m.household_id
  where m.user_id = p_user and m.left_at is null and h.archived_at is null
$$;

create or replace function atokore_private.clean_name(p text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p, ''));
begin
  if char_length(v) < 1 or char_length(v) > p_max then raise exception 'bad_name' using errcode = '22023'; end if;
  return v;
end $$;

create or replace function atokore_private.valid_field(p_kind text, p_key text, p_value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p_key ~ '^[A-Za-z][A-Za-z0-9]{0,31}$'
     and p_key not in ('id', 'qty')
     and char_length(p_value::text) <= 4000
     and (p_key <> 'name' or (jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 120))
     and (p_key <> 'items' or p_kind <> 'routine' or (jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) <= 100))
$$;

create or replace function atokore_private.valid_fields(p_kind text, p_fields jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; n int := 0;
begin
  if jsonb_typeof(p_fields) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p_fields) loop
    n := n + 1;
    if n > 40 or not atokore_private.valid_field(p_kind, k, v) then return false; end if;
  end loop;
  return true;
end $$;

-- Client clocks are only trusted within bounds, so one wrong clock cannot pin a field forever.
create or replace function atokore_private.clock(p_ts jsonb) returns bigint
language plpgsql stable set search_path = '' as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint; v bigint;
begin
  begin v := (p_ts #>> '{}')::bigint; exception when others then v := now_ms; end;
  if v is null then v := now_ms; end if;
  return least(greatest(v, now_ms - 2592000000), now_ms + 60000);
end $$;

-- Applies one validated operation. Returns a status; never raises for a bad operation
-- (a rejected operation must not discard the rest of the batch).
create or replace function atokore_private.apply_op(p_hh uuid, p_user uuid, p_op jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_type text := p_op->>'type';
  v_kind text := p_op->>'kind';
  v_id text := p_op->>'id';
  v_rec atokore_private.records%rowtype;
  v_ts bigint := atokore_private.clock(p_op->'ts');
  v_opid text := p_op->>'op_id';
  v_field text; v_value jsonb; v_old jsonb; v_delta numeric; v_qty numeric;
  v_clocks jsonb; k text; v jsonb; v_count int; v_limit int; v_item text;
begin
  if v_type = 'complete_buy' then
    v_kind := 'buy'; v_id := p_op->>'buy';
  end if;
  if v_kind not in ('item', 'buy', 'routine') or v_id is null or v_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return 'rejected:bad_target';
  end if;
  select * into v_rec from atokore_private.records r where r.household_id = p_hh and r.kind = v_kind and r.id = v_id for update;

  if v_type = 'create' then
    if found then return case when v_rec.deleted then 'skipped_deleted' else 'exists' end; end if;
    if not atokore_private.valid_fields(v_kind, coalesce(p_op->'fields', '{}'::jsonb)) or not (p_op->'fields' ? 'name') then
      return 'rejected:bad_fields';
    end if;
    begin v_qty := coalesce((p_op->>'qty')::numeric, 0); exception when others then return 'rejected:bad_qty'; end;
    if v_qty < 0 or v_qty > 99999 or v_qty <> trunc(v_qty) then return 'rejected:bad_qty'; end if;
    select count(*) into v_count from atokore_private.records r where r.household_id = p_hh and not r.deleted;
    select h.record_limit into v_limit from atokore_private.households h where h.id = p_hh;
    if v_count >= v_limit then return 'rejected:record_limit'; end if;
    v_clocks := '{}'::jsonb;
    for k, v in select * from jsonb_each(p_op->'fields') loop
      v_clocks := v_clocks || jsonb_build_object(k, jsonb_build_object('t', v_ts, 'o', v_opid));
    end loop;
    insert into atokore_private.records (household_id, kind, id, fields, clocks, qty, seq, created_by, updated_by)
    values (p_hh, v_kind, v_id, p_op->'fields', v_clocks, v_qty, nextval('atokore_private.change_seq'), p_user, p_user);
    return 'applied';
  end if;

  if not found then return 'missing'; end if;

  if v_type = 'delete' then
    if v_rec.deleted then return 'already_deleted'; end if;
    update atokore_private.records set deleted = true, seq = nextval('atokore_private.change_seq'), updated_by = p_user, updated_at = now()
      where household_id = p_hh and kind = v_kind and id = v_id;
    return 'applied';
  end if;

  if v_type = 'complete_buy' then
    -- Two people finishing the same purchase restock it once: only the first completion counts.
    if v_rec.deleted then return 'skipped_completed'; end if;
    begin v_delta := (p_op->>'delta')::numeric; exception when others then return 'rejected:bad_delta'; end;
    if v_delta is null or v_delta < 1 or v_delta > 99999 or v_delta <> trunc(v_delta) then return 'rejected:bad_delta'; end if;
    v_item := p_op->>'item';
    if v_item is null or v_item !~ '^[A-Za-z0-9_-]{8,64}$' then return 'rejected:bad_target'; end if;
    update atokore_private.records set deleted = true, seq = nextval('atokore_private.change_seq'), updated_by = p_user, updated_at = now()
      where household_id = p_hh and kind = 'buy' and id = v_id;
    select * into v_rec from atokore_private.records r where r.household_id = p_hh and r.kind = 'item' and r.id = v_item for update;
    if found then
      if v_rec.deleted then return 'applied_item_deleted'; end if;
      update atokore_private.records set qty = least(qty + v_delta, 99999), seq = nextval('atokore_private.change_seq'), updated_by = p_user, updated_at = now()
        where household_id = p_hh and kind = 'item' and id = v_item;
      return 'applied';
    end if;
    if p_op ? 'item_fields' then
      return atokore_private.apply_op(p_hh, p_user, jsonb_build_object('type', 'create', 'kind', 'item', 'id', v_item,
        'fields', p_op->'item_fields', 'qty', v_delta, 'ts', p_op->'ts', 'op_id', v_opid));
    end if;
    return 'applied_no_item';
  end if;

  if v_rec.deleted then return 'skipped_deleted'; end if;

  if v_type = 'add' then
    if v_kind = 'routine' then return 'rejected:no_counter'; end if;
    begin v_delta := (p_op->>'delta')::numeric; exception when others then return 'rejected:bad_delta'; end;
    if v_delta is null or abs(v_delta) > 99999 or v_delta <> trunc(v_delta) or v_delta = 0 then return 'rejected:bad_delta'; end if;
    update atokore_private.records set qty = least(greatest(qty + v_delta, 0), 99999), seq = nextval('atokore_private.change_seq'), updated_by = p_user, updated_at = now()
      where household_id = p_hh and kind = v_kind and id = v_id;
    return 'applied';
  end if;

  if v_type = 'set' then
    v_field := p_op->>'field'; v_value := p_op->'value';
    if v_field is null or v_value is null or not atokore_private.valid_field(v_kind, v_field, v_value) then return 'rejected:bad_field'; end if;
    v_old := v_rec.clocks->v_field;
    if v_old is not null and ((v_old->>'t')::bigint > v_ts or ((v_old->>'t')::bigint = v_ts and (v_old->>'o') >= v_opid)) then
      return 'stale';
    end if;
    update atokore_private.records set fields = fields || jsonb_build_object(v_field, v_value),
      clocks = clocks || jsonb_build_object(v_field, jsonb_build_object('t', v_ts, 'o', v_opid)),
      seq = nextval('atokore_private.change_seq'), updated_by = p_user, updated_at = now()
      where household_id = p_hh and kind = v_kind and id = v_id;
    return 'applied';
  end if;

  return 'rejected:bad_type';
end $$;

create or replace function atokore_private.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := uuid_send(gen_random_uuid()); s text := ''; i int;
begin
  for i in 0..7 loop s := s || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
  return s;
end $$;

create or replace function atokore_private.code_hash(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

create or replace function atokore_private.household_json(p_hh uuid, p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'household', jsonb_build_object('id', h.id, 'name', h.name, 'plan', h.plan, 'plan_expires_at', h.plan_expires_at, 'seat_limit', h.seat_limit),
    'me', (select jsonb_build_object('role', m.role, 'display_name', m.display_name) from atokore_private.members m
           where m.household_id = h.id and m.user_id = p_user and m.left_at is null),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name, 'role', m.role,
                 'joined_at', m.joined_at, 'is_me', m.user_id = p_user) order by m.joined_at), '[]'::jsonb)
                from atokore_private.members m where m.household_id = h.id and m.left_at is null))
  from atokore_private.households h where h.id = p_hh
$$;

-- ---------------------------------------------------------------- client API (RPC)

create or replace function public.hh_my() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
begin
  if v_hh is null then return jsonb_build_object('household', null); end if;
  return atokore_private.household_json(v_hh, v_user);
end $$;

create or replace function public.hh_create(p_name text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid;
begin
  if atokore_private.my_household(v_user) is not null then raise exception 'already_member' using errcode = '23505'; end if;
  insert into atokore_private.households (name, created_by) values (atokore_private.clean_name(coalesce(nullif(btrim(p_name), ''), 'わが家'), 40), v_user)
    returning id into v_hh;
  insert into atokore_private.members (household_id, user_id, role, display_name)
    values (v_hh, v_user, 'owner', atokore_private.clean_name(p_display_name, 20));
  return atokore_private.household_json(v_hh, v_user);
end $$;

create or replace function public.hh_invite_create() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
  v_code text; v_active int; v_limit int; v_expires timestamptz := now() + interval '24 hours';
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  perform 1 from atokore_private.households where id = v_hh for update;
  select count(*) into v_active from atokore_private.members where household_id = v_hh and left_at is null;
  select seat_limit into v_limit from atokore_private.households where id = v_hh;
  if v_active >= v_limit then raise exception 'seat_limit' using errcode = '23514'; end if;
  -- One open invite per household at a time: a new one replaces the previous.
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and used_at is null and revoked_at is null;
  v_code := atokore_private.new_code();
  insert into atokore_private.invites (code_hash, household_id, created_by, expires_at) values (atokore_private.code_hash(v_code), v_hh, v_user, v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end $$;

create or replace function public.hh_invite_revoke() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); n int;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end $$;

create or replace function public.hh_join(p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_inv atokore_private.invites%rowtype; v_active int; v_limit int; v_fail int; v_reason text;
begin
  if atokore_private.my_household(v_user) is not null then raise exception 'already_member' using errcode = '23505'; end if;
  select count(*) into v_fail from atokore_private.join_attempts where user_id = v_user and not ok and at > now() - interval '1 hour';
  if v_fail >= 10 then raise exception 'too_many_attempts' using errcode = '54000'; end if;
  select * into v_inv from atokore_private.invites where code_hash = atokore_private.code_hash(p_code) for update;
  v_reason := case when not found then 'invalid_code' when v_inv.used_at is not null then 'used_code'
    when v_inv.revoked_at is not null then 'revoked_code' when v_inv.expires_at <= now() then 'expired_code' end;
  if v_reason is not null then
    insert into atokore_private.join_attempts (user_id, ok) values (v_user, false);
    return jsonb_build_object('error', v_reason);
  end if;
  perform 1 from atokore_private.households where id = v_inv.household_id and archived_at is null for update;
  if not found then return jsonb_build_object('error', 'invalid_code'); end if;
  select count(*) into v_active from atokore_private.members where household_id = v_inv.household_id and left_at is null;
  select seat_limit into v_limit from atokore_private.households where id = v_inv.household_id;
  if v_active >= v_limit then return jsonb_build_object('error', 'seat_limit'); end if;
  update atokore_private.invites set used_by = v_user, used_at = now() where code_hash = v_inv.code_hash;
  insert into atokore_private.members (household_id, user_id, role, display_name)
    values (v_inv.household_id, v_user, 'member', atokore_private.clean_name(p_display_name, 20));
  insert into atokore_private.join_attempts (user_id, ok) values (v_user, true);
  return atokore_private.household_json(v_inv.household_id, v_user);
end $$;

-- Leaving stops sharing; the device keeps its copy. Nothing is deleted on the server.
create or replace function public.hh_leave() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); v_role text; v_next uuid;
begin
  if v_hh is null then return jsonb_build_object('left', false); end if;
  perform 1 from atokore_private.households where id = v_hh for update;
  update atokore_private.members set left_at = now() where household_id = v_hh and user_id = v_user and left_at is null returning role into v_role;
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and created_by = v_user and used_at is null and revoked_at is null;
  if v_role = 'owner' then
    select user_id into v_next from atokore_private.members where household_id = v_hh and left_at is null order by joined_at limit 1;
    if v_next is null then
      update atokore_private.households set archived_at = now() where id = v_hh;
      update atokore_private.invites set revoked_at = now() where household_id = v_hh and used_at is null and revoked_at is null;
    else
      update atokore_private.members set role = 'owner' where household_id = v_hh and user_id = v_next and left_at is null;
    end if;
  end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.hh_remove_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); n int;
begin
  if v_hh is null or not exists (select 1 from atokore_private.members where household_id = v_hh and user_id = v_user and left_at is null and role = 'owner') then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_user = v_user then raise exception 'use_leave' using errcode = '22023'; end if;
  update atokore_private.members set left_at = now() where household_id = v_hh and user_id = p_user and left_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('removed', n);
end $$;

create or replace function public.hh_push(p_ops jsonb, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
  v_op jsonb; v_opid uuid; v_status text; v_results jsonb := '[]'::jsonb; n int; v_cursor bigint;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then raise exception 'bad_batch' using errcode = '22023'; end if;
  -- Serialize writes per household, so change numbers (seq) are handed out in commit order.
  perform 1 from atokore_private.households where id = v_hh for update;
  for v_op in select * from jsonb_array_elements(p_ops) loop
    begin v_opid := (v_op->>'op_id')::uuid; exception when others then v_opid := null; end;
    if v_opid is null or jsonb_typeof(v_op) <> 'object' or char_length(v_op::text) > 8000 then
      v_results := v_results || jsonb_build_array(jsonb_build_object('op_id', v_op->>'op_id', 'status', 'rejected:bad_op'));
      continue;
    end if;
    insert into atokore_private.ops (household_id, op_id, actor, device, type, kind, record_id, body, result)
      values (v_hh, v_opid, v_user, left(p_device, 40), left(coalesce(v_op->>'type', ''), 20), left(v_op->>'kind', 10),
              left(coalesce(v_op->>'id', v_op->>'buy'), 64), v_op, 'pending')
      on conflict do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      v_status := 'duplicate';
    else
      v_status := atokore_private.apply_op(v_hh, v_user, v_op);
      update atokore_private.ops set result = v_status where household_id = v_hh and op_id = v_opid;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('op_id', v_opid, 'status', v_status));
  end loop;
  select coalesce(max(seq), 0) into v_cursor from atokore_private.records where household_id = v_hh;
  return jsonb_build_object('results', v_results, 'cursor', v_cursor);
end $$;

create or replace function public.hh_pull(p_since bigint default 0, p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 500), 1), 1000);
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

-- Who changed what, for the household's own history screen (applied operations only).
create or replace function public.hh_changes(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(c order by (c->>'at') desc), '[]'::jsonb) from (
    select jsonb_build_object('at', o.at, 'type', o.type, 'kind', o.kind, 'result', o.result,
      'who', coalesce((select m.display_name from atokore_private.members m where m.household_id = v_hh and m.user_id = o.actor order by m.joined_at desc limit 1), '?'),
      'name', (select r.fields->>'name' from atokore_private.records r where r.household_id = v_hh and r.kind = coalesce(o.kind, 'buy') and r.id = o.record_id),
      'delta', o.body->'delta', 'field', o.body->>'field') c
    from atokore_private.ops o where o.household_id = v_hh and o.result like 'applied%'
    order by o.at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) s);
end $$;

-- Only signed-in users may call the API; table access stays closed to everyone.
do $$
declare f text;
begin
  foreach f in array array['hh_my()', 'hh_create(text, text)', 'hh_invite_create()', 'hh_invite_revoke()', 'hh_join(text, text)',
    'hh_leave()', 'hh_remove_member(uuid)', 'hh_push(jsonb, text)', 'hh_pull(bigint, int)', 'hh_changes(int)'] loop
    -- Supabase grants new public functions to anon by default; signed-out callers get nothing.
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema atokore_private from public;
