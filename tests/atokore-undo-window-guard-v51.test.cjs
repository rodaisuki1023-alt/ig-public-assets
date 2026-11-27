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
  for(const fn of RPCS)for(const via of ['sync','resend','ticket']){   // Work 9th: an empty list is refused outright (atokore-purchase-op-forecast-v51)
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
  await assert.rejects(call(db,A,'hh_push_v51',{p_ops:[p1,p2],p_receipt_ops:[p1.op_id,'50000000-0000-4000-8000-000000000009']}),/purchase_receipt_input_invalid/,'Work 9th: an id outside the call refuses it');
  const r=await call(db,A,'hh_push_v51',{p_ops:[p1,p2],p_receipt_ops:[p1.op_id]});
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
// Work 9th: the forecast tests (op-id ownership) and the E rollback with re-purchase moved to
// tests/atokore-purchase-op-forecast-v51.test.cjs.
