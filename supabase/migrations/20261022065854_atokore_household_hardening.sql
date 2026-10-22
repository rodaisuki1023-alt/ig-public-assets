-- Household rollout hardening. Historical migrations stay unchanged.
-- Every mutation rechecks membership AFTER waiting for the household row lock.
create or replace function atokore_private.lock_member(p_user uuid, p_owner boolean default false) returns uuid
language plpgsql volatile set search_path = '' as $$
declare v_hh uuid := atokore_private.my_household(p_user);
begin
  if v_hh is not null then
    perform 1 from atokore_private.households where id = v_hh and archived_at is null for update;
    if found then
      -- A new SPI statement observes revocation committed while the row lock was awaited.
      perform 1 from atokore_private.members where household_id = v_hh and user_id = p_user
        and left_at is null and (not p_owner or role = 'owner');
      if found then return v_hh; end if;
    end if;
  end if;
  raise exception '%', case when p_owner then 'not_owner' else 'not_member' end using errcode = '42501';
end $$;
revoke all on function atokore_private.lock_member(uuid, boolean) from public, anon, authenticated;


create or replace function atokore_private.valid_fields(p_kind text, p_fields jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; n int := 0;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' then return false; end if;
  for k, v in select * from jsonb_each(p_fields) loop
    n := n + 1;
    if n > 40 or not atokore_private.valid_field(p_kind, k, v) then return false; end if;
  end loop;
  return true;
end $$;

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
  if v_kind is null or v_kind not in ('item', 'buy', 'routine') or v_id is null or v_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return 'rejected:bad_target';
  end if;
  select * into v_rec from atokore_private.records r where r.household_id = p_hh and r.kind = v_kind and r.id = v_id for update;

  if v_type = 'create' then
    if found then return case when v_rec.deleted then 'skipped_deleted' else 'exists' end; end if;
    if not atokore_private.valid_fields(v_kind, p_op->'fields') or not coalesce(p_op->'fields' ? 'name', false) then
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

create or replace function public.hh_invite_create() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user);
  v_code text; v_active int; v_limit int; v_expires timestamptz := now() + interval '24 hours';
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  perform 1 from atokore_private.households where id = v_hh for update;
  select count(*) into v_active from atokore_private.members where household_id = v_hh and left_at is null;
  v_limit := atokore_private.seat_limit(v_hh);
  if v_active >= v_limit then raise exception 'seat_limit' using errcode = '23514'; end if;
  -- One open invite per household at a time: a new one replaces the previous.
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and used_at is null and revoked_at is null;
  v_code := atokore_private.new_code();
  insert into atokore_private.invites (code_hash, household_id, created_by, expires_at) values (atokore_private.code_hash(v_code), v_hh, v_user, v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end $$;

create or replace function public.hh_invite_revoke() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user); n int;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end $$;

create or replace function public.hh_push(p_ops jsonb, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user);
  v_op jsonb; v_opid uuid; v_status text; v_results jsonb := '[]'::jsonb; n int; v_cursor bigint;
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) > 200 then raise exception 'bad_batch' using errcode = '22023'; end if;
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
      select case when result like 'rejected:%' then result else 'duplicate' end into v_status
        from atokore_private.ops where household_id = v_hh and op_id = v_opid;
    else
      -- Logical rejection and expected malformed-data exceptions roll back THIS operation only.
      -- Its idempotency receipt remains outside the subtransaction.
      begin
        v_status := atokore_private.apply_op(v_hh, v_user, v_op);
        if v_status like 'rejected:%' then
          raise exception using errcode = 'A4001', message = v_status;
        end if;
      exception
        when sqlstate 'A4001' then null;
        when data_exception or integrity_constraint_violation then v_status := 'rejected:bad_op';
      end;
      update atokore_private.ops set result = v_status where household_id = v_hh and op_id = v_opid;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('op_id', v_opid, 'status', v_status));
  end loop;
  select coalesce(max(seq), 0) into v_cursor from atokore_private.records where household_id = v_hh;
  return jsonb_build_object('results', v_results, 'cursor', v_cursor);
end $$;

create or replace function public.hh_remove_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user, true); n int;
begin
  if v_hh is null or not exists (select 1 from atokore_private.members where household_id = v_hh and user_id = v_user and left_at is null and role = 'owner') then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_user = v_user then raise exception 'use_leave' using errcode = '22023'; end if;
  update atokore_private.members set left_at = now() where household_id = v_hh and user_id = p_user and left_at is null;
  get diagnostics n = row_count;
  update atokore_private.invites set revoked_at = now() where household_id = v_hh and created_by = p_user and used_at is null and revoked_at is null;
  return jsonb_build_object('removed', n);
end $$;

create or replace function public.hh_consume(p_feature text, p_event_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user);
begin
  if v_hh is null then raise exception 'not_member' using errcode = '42501'; end if;
  return atokore_private.consume(v_hh, v_user, p_feature, p_event_key);
end $$;

create or replace function public.hh_create(p_name text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if atokore_private.my_household(v_user) is not null then raise exception 'already_member' using errcode = '23505'; end if;
  insert into atokore_private.households (name, created_by) values (atokore_private.clean_name(coalesce(nullif(btrim(p_name), ''), 'わが家'), 40), v_user)
    returning id into v_hh;
  insert into atokore_private.members (household_id, user_id, role, display_name)
    values (v_hh, v_user, 'owner', atokore_private.clean_name(p_display_name, 20));
  return atokore_private.household_json(v_hh, v_user);
end $$;

create or replace function public.hh_leave() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user); v_role text; v_next uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  v_hh := atokore_private.my_household(v_user);
  if v_hh is null then return jsonb_build_object('left', false); end if;
  perform 1 from atokore_private.households where id = v_hh for update;
  if not exists (select 1 from atokore_private.members where household_id = v_hh and user_id = v_user and left_at is null) then return jsonb_build_object('left', false); end if;
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

create or replace function public.hh_join(p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_inv atokore_private.invites%rowtype;
  v_hh uuid; v_active int; v_limit int; v_fail int; v_reason text;
begin
  -- Serialize joins for one user, including the failed-attempt counter.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if atokore_private.my_household(v_user) is not null then raise exception 'already_member' using errcode = '23505'; end if;
  select count(*) into v_fail from atokore_private.join_attempts where user_id = v_user and not ok and at > now() - interval '1 hour';
  if v_fail >= 10 then raise exception 'too_many_attempts' using errcode = '54000'; end if;
  -- Discover the household without locking the invitation. All writers lock household first.
  select household_id into v_hh from atokore_private.invites where code_hash = atokore_private.code_hash(p_code);
  if v_hh is not null then
    perform 1 from atokore_private.households where id = v_hh and archived_at is null for update;
    if not found then v_hh := null; end if;
  end if;
  if v_hh is null then
    v_reason := 'invalid_code';
  else
    select * into v_inv from atokore_private.invites where code_hash = atokore_private.code_hash(p_code) and household_id = v_hh for update;
    v_reason := case when not found then 'invalid_code' when v_inv.used_at is not null then 'used_code'
      when v_inv.revoked_at is not null then 'revoked_code' when v_inv.expires_at <= now() then 'expired_code'
      when not exists (select 1 from atokore_private.members where household_id = v_hh and user_id = v_inv.created_by and left_at is null) then 'revoked_code' end;
  end if;
  if v_reason is not null then
    insert into atokore_private.join_attempts (user_id, ok) values (v_user, false);
    return jsonb_build_object('error', v_reason);
  end if;
  select count(*) into v_active from atokore_private.members where household_id = v_hh and left_at is null;
  v_limit := atokore_private.seat_limit(v_hh);
  if v_active >= v_limit then return jsonb_build_object('error', 'seat_limit'); end if;
  update atokore_private.invites set used_by = v_user, used_at = now() where code_hash = v_inv.code_hash;
  insert into atokore_private.members (household_id, user_id, role, display_name)
    values (v_hh, v_user, 'member', atokore_private.clean_name(p_display_name, 20));
  insert into atokore_private.join_attempts (user_id, ok) values (v_user, true);
  return atokore_private.household_json(v_hh, v_user);
end $$;
