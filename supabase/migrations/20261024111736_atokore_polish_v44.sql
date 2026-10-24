-- v44: server-observed activity and atomic, actor-scoped purchase undo.
create or replace function public.hh_push(p_ops jsonb, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.lock_member(v_user);
  v_op jsonb; v_opid uuid; v_before jsonb; v_after jsonb; v_target jsonb; v_status text; v_results jsonb := '[]'::jsonb; n int; v_cursor bigint;
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
    -- Only server-observed values enter the history or a reversible purchase receipt.
    v_op := v_op - array['_beforeQty','_afterQty','_name','_unit','_undo_done','_itemBefore','_itemAfter'];
    select jsonb_build_object('qty',r.qty,'name',r.fields->>'name','unit',r.fields->>'unit') into v_before
      from atokore_private.records r where r.household_id=v_hh and r.kind=coalesce(v_op->>'kind','buy') and r.id=coalesce(v_op->>'id',v_op->>'buy');
    v_op := v_op || jsonb_build_object('_beforeQty',v_before->'qty','_name',v_before->'name','_unit',v_before->'unit');
    if v_op->>'type'='complete_buy' then
      select jsonb_build_object('qty',r.qty) into v_target from atokore_private.records r where r.household_id=v_hh and r.kind='item' and r.id=v_op->>'item';
      v_op := v_op || jsonb_build_object('_itemBefore',coalesce(v_target->'qty','0'::jsonb));
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
      select jsonb_build_object('qty',r.qty,'name',r.fields->>'name','unit',r.fields->>'unit') into v_after
        from atokore_private.records r where r.household_id=v_hh and r.kind=coalesce(v_op->>'kind','buy') and r.id=coalesce(v_op->>'id',v_op->>'buy');
      v_op := v_op || jsonb_build_object('_afterQty',v_after->'qty','_name',coalesce(v_before->>'name',v_after->>'name'),'_unit',coalesce(v_before->>'unit',v_after->>'unit'));
      if v_op->>'type'='complete_buy' then
        select jsonb_build_object('qty',r.qty) into v_target from atokore_private.records r where r.household_id=v_hh and r.kind='item' and r.id=v_op->>'item';
        v_op := v_op || jsonb_build_object('_itemAfter',v_target->'qty');
      end if;
      update atokore_private.ops set body=v_op, result = v_status where household_id = v_hh and op_id = v_opid;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('op_id', v_opid, 'status', v_status));
  end loop;
  select coalesce(max(seq), 0) into v_cursor from atokore_private.records where household_id = v_hh;
  return jsonb_build_object('results', v_results, 'cursor', v_cursor);
end $$;

create or replace function public.hh_changes(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := atokore_private.require_user(); v_hh uuid := atokore_private.my_household(v_user);
begin
 if v_hh is null then raise exception 'not_member' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(c order by (c->>'at') desc),'[]'::jsonb) from (
  select jsonb_build_object('at',o.at,'type',o.type,'kind',o.kind,'result',o.result,
   'who',coalesce((select m.display_name from atokore_private.members m where m.household_id=v_hh and m.user_id=o.actor order by m.joined_at desc limit 1),'家族'),
   'name',coalesce(o.body->>'_name',(select r.fields->>'name' from atokore_private.records r where r.household_id=v_hh and r.kind=coalesce(o.kind,'buy') and r.id=o.record_id)),
   'unit',coalesce(o.body->>'_unit','個'),'beforeQty',o.body->'_beforeQty','afterQty',o.body->'_afterQty',
   'delta',o.body->'delta','field',o.body->>'field') c
  from atokore_private.ops o where o.household_id=v_hh and o.result like 'applied%'
  order by o.at desc,o.op_id limit least(greatest(coalesce(p_limit,50),1),100)) s);
end $$;

-- Compensate only this caller's acknowledged purchase, once. No whole-list restore.
-- A dropped HTTP answer can be retried: the original receipt records its undo atomically.
create or replace function public.hh_undo_purchases(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=atokore_private.require_user(); h uuid:=atokore_private.lock_member(u);
 p jsonb; original atokore_private.ops%rowtype; item atokore_private.records%rowtype; buy atokore_private.records%rowtype;
 amount numeric; oid uuid; added numeric; n int:=0;
begin
 if h is null then raise exception 'not_member' using errcode='42501'; end if;
 if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) not between 1 and 100 then raise exception 'bad_batch' using errcode='22023'; end if;
 perform 1 from atokore_private.households where id=h for update;
 for p in select * from jsonb_array_elements(p_ops) loop
  oid:=(p #>> '{}')::uuid;
  select * into original from atokore_private.ops where household_id=h and op_id=oid for update;
  if not found or original.actor<>u or original.type<>'complete_buy' or original.result<>'applied' then raise exception 'purchase_not_reversible' using errcode='22023'; end if;
  if original.body->>'_undo_done'='true' then continue; end if;
  select * into item from atokore_private.records where household_id=h and kind='item' and id=original.body->>'item' for update;
  select * into buy from atokore_private.records where household_id=h and kind='buy' and id=original.body->>'buy' for update;
  added:=(original.body->>'_itemAfter')::numeric-(original.body->>'_itemBefore')::numeric;
  if item.id is null or item.deleted or buy.id is null or not buy.deleted or added is null or added<0 or item.qty<added then raise exception 'purchase_changed' using errcode='22023'; end if;
  update atokore_private.records set qty=qty-added,seq=nextval('atokore_private.change_seq'),updated_by=u,updated_at=now() where household_id=h and kind='item' and id=item.id;
  update atokore_private.records set deleted=false,seq=nextval('atokore_private.change_seq'),updated_by=u,updated_at=now() where household_id=h and kind='buy' and id=buy.id;
  update atokore_private.ops set body=body||'{"_undo_done":true}'::jsonb where household_id=h and op_id=oid;
  insert into atokore_private.ops(household_id,op_id,actor,type,kind,record_id,body,result)
   values(h,gen_random_uuid(),u,'undo_purchase','buy',buy.id,jsonb_build_object('_name',buy.fields->>'name','_unit',buy.fields->>'unit','delta',added),'applied');
  n:=n+1;
 end loop;
 return jsonb_build_object('undone',n);
end $$;
revoke all on function public.hh_undo_purchases(jsonb) from public, anon;
grant execute on function public.hh_undo_purchases(jsonb) to authenticated;
