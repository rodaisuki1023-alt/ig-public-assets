// v51 E: the 10-minute undo window on EVERY entry for trial households (Work 6th: the old RPC bypassed it).
// Work 8th: undo rights come only from a RECEIPT the server writes when it accepts a purchase through the
// dedicated purchase command (hh_push_v51 with the op listed, first applied in that call). The window is 10
// minutes from that receive time. Ordinary sync, resends, cached / reused clock tickets and the offline outbox
// grant nothing. The estimate entries are owned by the purchase (sb = its shopping rows), decided by the server.
// Isolated PGlite only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000002a1',B='00000000-0000-4000-8000-0000000002b1',R='00000000-0000-4000-8000-0000000002e1';
let n=0;const oid=()=>'30000000-0000-4000-8000-'+String(++n).padStart(12,'0');
// A purchase the server received `ageS` seconds ago. via: 'command' (receipt), 'sync' (ordinary hh_push, e.g.
// the offline outbox after reconnecting), 'unlisted' (command, op not listed), 'resend' (sync first, then the
// command lists it: a duplicate gets no receipt), 'ticket' (the earlier design: a clock ticket id in the op).
async function bought(db,uid,{ageS,via='command',est=null,item:itemId=null,buy:buyId=null,newBuy=true}){
 const item=itemId||'item-qe-'+n,buy=buyId||'buy-qe-'+n;
 const ops=[];
 if(newBuy)ops.push({op_id:oid(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()});
 if(!itemId)ops.unshift({op_id:oid(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()});
 if(ops.length)await call(db,uid,'hh_push',{p_ops:ops});
 const at=Date.now()-ageS*1000,done={op_id:oid(),type:'complete_buy',buy,item,delta:2,ts:at};
 if(est)done.est=est;
 if(via==='ticket')done.ck='40000000-0000-4000-8000-000000000001';
 if(via==='command')await call(db,uid,'hh_push_v51',{p_ops:[done],p_receipt_ops:[done.op_id]});
 else if(via==='unlisted')await call(db,uid,'hh_push_v51',{p_ops:[done],p_receipt_ops:[]});
 else if(via==='resend'){await call(db,uid,'hh_push',{p_ops:[done]});await call(db,uid,'hh_push_v51',{p_ops:[done],p_receipt_ops:[done.op_id]})}
 else await call(db,uid,'hh_push',{p_ops:[done]});
 await db.query("UPDATE atokore_private.ops SET at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 await db.query("UPDATE atokore_private.purchase_receipts_v51 SET received_at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 return {op:done.op_id,item,buy};
}
const qty=async(db,id)=>Number((await db.query("SELECT qty FROM atokore_private.records WHERE id=$1",[id])).rows[0].qty);
const fields=async(db,id)=>(await db.query("SELECT fields FROM atokore_private.records WHERE id=$1",[id])).rows[0].fields;
const asUser=(db,uid,fn,ops)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return (await tx.query('select public.'+fn+'($1::jsonb) r',[JSON.stringify(ops)])).rows[0].r});
const set=(db,uid,item,field,value)=>call(db,uid,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field,value}]});
const entry=(k,sb,extra={})=>({v:1,k,q:2,u:60,d:'2026-11-27',t:Date.now(),...(sb?{sb}:{}),...extra});
async function fixture(){
 const db=await createDb();await db.exec(P('atokore-purchase-undo-window-v51.sql'));
 await call(db,A,'hh_create',{p_name:'QA undo guard',p_display_name:'A'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await call(db,R,'hh_create',{p_name:'real',p_display_name:'R'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'QA guard' FROM atokore_private.households WHERE name='QA undo guard'");
 return db;
}
const RPCS=['hh_undo_purchases','hh_undo_purchases_v51'];
test('E regression (Work 6th): the OLD rpc cannot undo an expired purchase of a trial household',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[p.op]),/purchase_undo_expired/);
  assert.equal(await qty(db,p.item),3,'stock stays as bought');
  assert.equal((await db.query("SELECT body->>'_undo_done' d FROM atokore_private.ops WHERE op_id=$1",[p.op])).rows[0].d,null,'receipt unchanged');
 }finally{await db.close()}
});
test('E: both RPCs share the boundary 9:59 ok / 10:00 and 10:01 refused, measured from the server receipt',async()=>{
 const db=await fixture();
 try{
  for(const fn of RPCS){
   const ok=await bought(db,A,{ageS:599});
   assert.equal((await asUser(db,A,fn,[ok.op])).undone,1,fn+' 9:59');
   for(const age of [600,601]){const p=await bought(db,A,{ageS:age});await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_expired/,fn+' '+age);assert.equal(await qty(db,p.item),3)}
  }
 }finally{await db.close()}
});
test('E (Work 8th): an offline purchase synced after reconnecting, a resend, an unlisted op or a clock ticket grant no undo right',async()=>{
 const db=await fixture();
 try{
  for(const fn of RPCS)for(const via of ['sync','resend','unlisted','ticket']){
   const p=await bought(db,A,{ageS:5,via});
   await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_unprovable/,fn+' '+via);
   assert.equal(await qty(db,p.item),3,'nothing changed');
  }
  // Work 8th: the same (old-style) ticket in two purchases made after it: neither is undoable.
  const a=await bought(db,A,{ageS:5,via:'ticket'}),b=await bought(db,A,{ageS:4,via:'ticket'});
  await assert.rejects(asUser(db,A,'hh_undo_purchases_v51',[a.op]),/purchase_undo_unprovable/);
  await assert.rejects(asUser(db,A,'hh_undo_purchases_v51',[b.op]),/purchase_undo_unprovable/);
  assert.equal(await call(db,A,'hh_my').then(()=>db.query("SELECT to_regprocedure('public.hh_clock_ticket_v51()') IS NULL gone")).then(r=>r.rows[0].gone),true,'the ticket RPC is gone');
 }finally{await db.close()}
});
test('E: a mixed batch through the command gives a receipt only to the listed purchase applied in that call',async()=>{
 const db=await fixture();
 try{
  await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:'item-mix',qty:1,fields:{name:'合成 ミルク',unit:'缶'}},
   {op_id:oid(),type:'create',kind:'buy',id:'buy-mix-1',qty:2,fields:{name:'合成 ミルク',unit:'缶'}},{op_id:oid(),type:'create',kind:'buy',id:'buy-mix-2',qty:2,fields:{name:'合成 ミルク',unit:'缶'}}]});
  const p1={op_id:oid(),type:'complete_buy',buy:'buy-mix-1',item:'item-mix',delta:2,ts:Date.now()},p2={op_id:oid(),type:'complete_buy',buy:'buy-mix-2',item:'item-mix',delta:2,ts:Date.now()};
  const r=await call(db,A,'hh_push_v51',{p_ops:[p1,p2],p_receipt_ops:[p1.op_id,'50000000-0000-4000-8000-000000000009']});
  assert.deepEqual([r.status,r.receipts],['ready',[p1.op_id]]);
  const rc=(await db.query('SELECT actor::text,item_id,buy_id,qty::int FROM atokore_private.purchase_receipts_v51 WHERE op_id=$1',[p1.op_id])).rows[0];
  assert.deepEqual(rc,{actor:A,item_id:'item-mix',buy_id:'buy-mix-1',qty:2},'op, actor, product, row and quantity fixed together');
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[p1.op_id])).undone,1);
  await assert.rejects(asUser(db,A,'hh_undo_purchases_v51',[p2.op_id]),/purchase_undo_unprovable/);
  // One expired in a batch: nothing changes.
  const fresh=await bought(db,A,{ageS:30}),old=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[fresh.op,old.op]),/purchase_undo_expired/);
  assert.equal(await qty(db,fresh.item),3,'not half-way');
  assert.equal((await asUser(db,A,'hh_undo_purchases',[fresh.op])).undone,1);
  await db.query("UPDATE atokore_private.purchase_receipts_v51 SET received_at=now()-interval '1 hour'");
  assert.equal((await asUser(db,A,'hh_undo_purchases',[fresh.op])).undone,0,'a retry of a finished undo still answers');
 }finally{await db.close()}
});
test('E: strict not_enabled — outside the trial the command applies nothing; old clients and real households are unchanged',async()=>{
 const db=await fixture();
 try{
  await call(db,R,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:'item-r',qty:1,fields:{name:'x',unit:'個'}},{op_id:oid(),type:'create',kind:'buy',id:'buy-r',qty:1,fields:{name:'x',unit:'個'}}]});
  const op={op_id:oid(),type:'complete_buy',buy:'buy-r',item:'item-r',delta:1,ts:Date.now()};
  assert.deepEqual(await call(db,R,'hh_push_v51',{p_ops:[op],p_receipt_ops:[op.op_id]}),{status:'not_enabled'});
  assert.equal((await db.query('SELECT count(*)::int c FROM atokore_private.ops WHERE op_id=$1',[op.op_id])).rows[0].c,0,'nothing applied');
  const p=await bought(db,R,{ageS:3600,via:'sync'});
  assert.equal((await asUser(db,R,'hh_undo_purchases',[p.op])).undone,1,'non-trial: any age, as before');
  assert.deepEqual(await asUser(db,R,'hh_undo_purchases_v51',[(await bought(db,R,{ageS:30,via:'sync'})).op]),{status:'not_enabled'});
  assert.equal((await db.query("SELECT has_function_privilege('anon','public.hh_push_v51(jsonb,jsonb,text)','EXECUTE') ok")).rows[0].ok,false);
  // Another member cannot undo A's purchase (the receipt names its actor).
  const q=await bought(db,A,{ageS:5});
  await assert.rejects(asUser(db,B,'hh_undo_purchases_v51',[q.op]),/purchase_not_reversible|purchase_undo_unprovable/);
 }finally{await db.close()}
});
test('forecast (Work 8th): the undo removes the entries the purchase OWNS (sb), also a late set without est; never another purchase\'s, whatever est says',async()=>{
 const db=await fixture();
 try{
  for(const fn of RPCS){
   const first=await bought(db,A,{ageS:30,est:[{field:'tpb2',k:'k-second'}]});        // est wrongly lists the second purchase
   const item=first.item;
   await set(db,A,item,'tpa1',entry('k-first',[first.buy]));                            // a late set (not in est)
   await set(db,A,item,'track',{v:1,seen:['k-first'],base:60});
   const second=await bought(db,A,{ageS:20,item});
   await set(db,A,item,'tpb2',entry('k-second',[second.buy]));
   assert.equal((await asUser(db,A,fn,[first.op])).undone,1);
   const f=await fields(db,item);
   assert.equal(f.tpa1,undefined,fn+': the late entry of this purchase is gone with the undo');
   assert.equal(f.tpb2?.k,'k-second','the other purchase is untouched although est named it');
   assert.equal(f.track.check,'purchase_undo','already counted: asks to check');
   assert.equal((await asUser(db,A,fn,[first.op])).undone,0,'only once');
   assert.equal(await qty(db,item),3,'stock: 1 + 2 + 2 - 2, undone once');
   // A stale write-back (no new purchase owns it): applies as a write, the entry is held, never deleted.
   assert.equal((await set(db,A,item,'tpa1',entry('k-first',[first.buy]))).results[0].status,'applied');
   assert.equal((await fields(db,item)).tpa1,undefined,'never back in the estimate');
   assert.equal((await db.query("SELECT count(*)::int c FROM atokore_private.purchase_forecast_quarantine_v51 WHERE item_id=$1 AND field='tpa1'",[item])).rows[0].c>=1,true,'held, not lost');
   await set(db,A,item,'tpb2',null);
  }
 }finally{await db.close()}
});
test('forecast (Work 8th): the same row bought again after an undo is a new purchase: its entry counts (120 -> 180 -> 120 -> 180)',async()=>{
 const db=await fixture();
 try{
  const p1=await bought(db,A,{ageS:30});
  await set(db,A,p1.item,'tpz9',entry('sb:row',[p1.buy]));
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[p1.op])).undone,1);
  assert.equal((await fields(db,p1.item)).tpz9,undefined);
  // Again the same shopping row (it came back with the undo): the set reaches the server BEFORE the purchase.
  const again={op_id:oid(),type:'complete_buy',buy:p1.buy,item:p1.item,delta:2,ts:Date.now()};
  const r=await call(db,A,'hh_push_v51',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:p1.item,field:'tpz9',value:entry('sb:row',[p1.buy])},again],p_receipt_ops:[again.op_id]});
  assert.deepEqual(r.results.map(x=>x.status),['applied','applied']);
  assert.equal((await fields(db,p1.item)).tpz9?.k,'sb:row','the new purchase owns the entry: counted');
  assert.equal(await qty(db,p1.item),3,'1 + 2 - 2 + 2');
  assert.equal(Number((await db.query("SELECT count(*) c FROM atokore_private.records WHERE id=$1 AND kind='buy' AND deleted",[p1.buy])).rows[0].c),1,'shopping row done again');
  // And it can be undone itself (its own receipt), once.
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[again.op_id])).undone,1);
  assert.equal((await fields(db,p1.item)).tpz9,undefined);
 }finally{await db.close()}
});
test('forecast (Work 8th): entries that cannot be verified are kept and flagged, never deleted by guess',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:30,est:[{field:'tpold',k:'k-old'}]});
  await set(db,A,p.item,'track',{v:1,seen:[],base:60});
  await set(db,A,p.item,'tpold',entry('k-old',null));                 // an old client: no sb
  await set(db,A,p.item,'tpmix',entry('k-mix',[p.buy,'buy-other']));  // two rows bought together
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[p.op])).undone,1);
  const f=await fields(db,p.item);
  assert.equal(f.tpold?.k,'k-old');assert.equal(f.tpmix?.k,'k-mix');assert.equal(f.track.check,'purchase_undo');
 }finally{await db.close()}
});
test('E rollback alone (Work 8th): the window goes; undone entries and the write-back guard stay; re-apply works',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:30});
  await set(db,A,p.item,'tpa1',entry('k-a',[p.buy]));
  assert.equal((await asUser(db,A,'hh_undo_purchases_v51',[p.op])).undone,1);
  const ops=(await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c;
  await db.exec(P('rollback/atokore-purchase-undo-window-v51.rollback.sql'));
  assert.equal((await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c,ops);
  assert.equal((await db.query("SELECT to_regprocedure('atokore_private.trial_allowed_v51(uuid)') IS NOT NULL k")).rows[0].k,true,'shared allowlist kept');
  assert.equal((await db.query("SELECT count(*)::int c FROM atokore_private.purchase_undone_entries_v51")).rows[0].c,1,'undone history kept');
  // The old phone writes the undone entry back after the rollback: still refused.
  await set(db,A,p.item,'tpa1',entry('k-a',[p.buy]));
  assert.equal((await fields(db,p.item)).tpa1,undefined,'write-back refused after the rollback');
  const old=await bought(db,A,{ageS:900,via:'sync'});
  assert.equal((await asUser(db,A,'hh_undo_purchases',[old.op])).undone,1,'undo as before the unit');
  await db.exec(P('atokore-purchase-undo-window-v51.sql'));                 // apply again: idempotent re-apply
  const q=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[q.op]),/purchase_undo_expired/);
 }finally{await db.close()}
});
