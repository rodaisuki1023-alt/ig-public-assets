-- PROPOSAL ONLY (v51, Work P1). Not a migration; not applied to any real project.
-- Adds the purchase-undo deadline to the server so family sharing has a strict guarantee:
-- the app refuses from 10:00 after the tap, and the server refuses from 10:00 after the purchase
-- reached it (its own clock). Near the boundary the server decides and the app shows the expired
-- message; nothing is changed. Everything else is the existing hh_undo_purchases unchanged
-- (supabase/migrations/20261024111736_atokore_polish_v44.sql). Rollback: re-run that definition.
-- Verified only in isolated PGlite (tests/atokore-purchase-undo-window-v51.test.cjs).

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
  -- v51: the same 10-minute window as the app, measured on the server's own clock from when the
  -- purchase reached the server. A phone whose clock was changed, or whose screen stayed open,
  -- cannot extend it. Elapsed >= 10:00 is refused. Checked after the retry case above, so an undo
  -- that already succeeded still answers its retry; checked before any update, so a refusal
  -- changes nothing (the whole batch rolls back).
  if original.at <= now() - interval '10 minutes' then raise exception 'purchase_undo_expired' using errcode='22023'; end if;
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
