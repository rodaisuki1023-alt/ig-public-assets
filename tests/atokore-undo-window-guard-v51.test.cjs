// v51 E: the 10-minute undo window on EVERY entry for trial households (Work 6th: the old RPC bypassed it),
// proven only from times the server issued itself (Work 7th: a well-formed phone time proves nothing).
// The window starts at the server's clock ticket the phone held before the purchase; no valid ticket ->
// purchase_undo_unprovable. The estimate entries of the purchase are removed in the same transaction.
// Isolated PGlite only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000002a1',B='00000000-0000-4000-8000-0000000002b1',R='00000000-0000-4000-8000-0000000002e1';
let n=0;const oid=()=>'30000000-0000-4000-8000-'+String(++n).padStart(12,'0');
// A purchase that reached the server `ageS` seconds ago. ticket: 'own' (issued `ticketS` s before the
// receipt), 'none', 'garbage', 'other-user', 'other-household', 'after' (issued after the receipt).
async function bought(db,uid,{ageS,ticket='own',ticketS=1,devS=0,est=null,item:itemId=null}){
 const item=itemId||'item-qe-'+n,buy='buy-qe-'+n;
 const ops=[{op_id:oid(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()}];
 if(!itemId)ops.unshift({op_id:oid(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()});
 await call(db,uid,'hh_push',{p_ops:ops});
 const at=Date.now()-ageS*1000,done={op_id:oid(),type:'complete_buy',buy,item,delta:2,ts:at-devS*1000};
 let ck=null;
 if(ticket!=='none'&&ticket!=='garbage'){
  const who=ticket==='other-user'?B:ticket==='other-household'?R:uid;
  const t=await call(db,who,'hh_clock_ticket_v51',{});
  ck=t.ticket;
  if(ck)await db.query("UPDATE atokore_private.purchase_clock_tickets_v51 SET issued_at=to_timestamp($1/1000.0) WHERE ticket=$2",[ticket==='after'?at+5000:at-ticketS*1000,ck]);
 }
 if(ticket==='garbage')ck='not-a-ticket';
 if(ck)done.ck=ck;
 if(est)done.est=est;
 await call(db,uid,'hh_push',{p_ops:[done]});
 await db.query("UPDATE atokore_private.ops SET at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 return {op:done.op_id,item,buy};
}
const qty=async(db,id)=>Number((await db.query("SELECT qty FROM atokore_private.records WHERE id=$1",[id])).rows[0].qty);
const fields=async(db,id)=>(await db.query("SELECT fields FROM atokore_private.records WHERE id=$1",[id])).rows[0].fields;
const asUser=(db,uid,fn,ops)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return (await tx.query('select public.'+fn+'($1::jsonb) r',[JSON.stringify(ops)])).rows[0].r});
async function fixture(){
 const db=await createDb();await db.exec(P('atokore-purchase-undo-window-v51.sql'));
 await call(db,A,'hh_create',{p_name:'QA undo guard',p_display_name:'A'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await call(db,R,'hh_create',{p_name:'real',p_display_name:'R'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'QA guard' FROM atokore_private.households WHERE name='QA undo guard'");
 return db;
}
test('E regression (Work 6th): the OLD rpc cannot undo an expired purchase of a trial household',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[p.op]),/purchase_undo_expired/);
  assert.equal(await qty(db,p.item),3,'stock stays as bought');
  assert.equal((await db.query("SELECT body->>'_undo_done' d FROM atokore_private.ops WHERE op_id=$1",[p.op])).rows[0].d,null,'receipt unchanged');
 }finally{await db.close()}
});
test('E: both RPCs share the boundary 9:59 ok / 10:00 and 10:01 refused, measured from the server ticket',async()=>{
 const db=await fixture();
 try{
  for(const fn of ['hh_undo_purchases','hh_undo_purchases_v51']){
   const ok=await bought(db,A,{ageS:598,ticketS:1});
   assert.equal((await asUser(db,A,fn,[ok.op])).undone,1,fn+' 9:59');
   for(const age of [599,600]){const p=await bought(db,A,{ageS:age,ticketS:1});await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_expired/,fn+' '+(age+1));assert.equal(await qty(db,p.item),3)}
  }
 }finally{await db.close()}
});
test('E (Work 7th): no server proof of the purchase time -> unprovable on every entry; a plausible phone time proves nothing',async()=>{
 const db=await fixture();
 try{
  for(const fn of ['hh_undo_purchases','hh_undo_purchases_v51']){
   // Bought offline long ago, synced 30 s ago, the phone (or an altered client) says "30 s ago": no ticket.
   for(const ticket of ['none','garbage','other-user','other-household','after']){
    const p=await bought(db,A,{ageS:30,ticket,devS:0});
    await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_unprovable/,fn+' '+ticket);
    assert.equal(await qty(db,p.item),3,'nothing changed');
   }
   // An old ticket (issued 15 min before the purchase reached the server) is valid proof — of an expired window.
   const old=await bought(db,A,{ageS:5,ticketS:15*60});
   await assert.rejects(asUser(db,A,fn,[old.op]),/purchase_undo_expired/);
  }
 }finally{await db.close()}
});
test('E: a mixed batch through the OLD rpc changes nothing; finished undos keep answering; history kept',async()=>{
 const db=await fixture();
 try{
  const fresh=await bought(db,A,{ageS:30}),old=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[fresh.op,old.op]),/purchase_undo_expired/);
  assert.equal(await qty(db,fresh.item),3,'not half-way');
  assert.equal((await asUser(db,A,'hh_undo_purchases',[fresh.op])).undone,1);
  await db.query("UPDATE atokore_private.purchase_clock_tickets_v51 SET issued_at=now()-interval '1 hour'");
  assert.equal((await asUser(db,A,'hh_undo_purchases',[fresh.op])).undone,0,'a retry of a finished undo still answers');
  const types=(await db.query("SELECT type FROM atokore_private.ops WHERE type IN ('complete_buy','undo_purchase')")).rows.map(r=>r.type);
  assert.equal(types.filter(t=>t==='undo_purchase').length,1);
 }finally{await db.close()}
});
test('E: non-trial households and old clients are unchanged (any age, no ticket); the ticket RPC answers not_enabled',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,R,{ageS:3600,ticket:'none'});
  assert.equal((await asUser(db,R,'hh_undo_purchases',[p.op])).undone,1);
  assert.deepEqual(await asUser(db,R,'hh_undo_purchases_v51',[(await bought(db,R,{ageS:30,ticket:'none'})).op]),{status:'not_enabled'});
  assert.deepEqual(await call(db,R,'hh_clock_ticket_v51',{}),{status:'not_enabled'});
  for(const role of ['anon'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.hh_clock_ticket_v51()','EXECUTE') ok",[role])).rows[0].ok,false);
 }finally{await db.close()}
});
test('estimate (Work 7th): the undo removes exactly this purchase\'s estimate entry in the same transaction; a later purchase stays',async()=>{
 const db=await fixture();
 try{
  for(const fn of ['hh_undo_purchases','hh_undo_purchases_v51']){
   const first=await bought(db,A,{ageS:30,est:[{field:'tpa1',k:'k-first'}]});
   const item=first.item;
   await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field:'tpa1',value:{v:1,k:'k-first',q:2,d:'2026-11-27'}},
     {op_id:oid(),type:'set',kind:'item',id:item,field:'track',value:{v:1,seen:['k-first'],base:60}}]});
   // An immediate re-purchase of the same product is another op with its own entry.
   const second=await bought(db,A,{ageS:20,item,est:[{field:'tpb2',k:'k-second'}]});
   await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field:'tpb2',value:{v:1,k:'k-second',q:2,d:'2026-11-27'}}]});
   const seq0=Number((await db.query("SELECT seq FROM atokore_private.records WHERE id=$1",[item])).rows[0].seq);
   assert.equal((await asUser(db,A,fn,[first.op])).undone,1);
   const f=await fields(db,item);
   assert.equal(f.tpa1,undefined,fn+': this purchase\'s entry is gone with the undo');
   assert.deepEqual(f.tpb2?.k,'k-second','the other purchase is untouched');
   assert.equal(f.track.check,'purchase_undo','already counted: asks to check');
   assert.equal(await qty(db,item),3,'stock: 1 + 2 + 2 - 2');
   assert.ok(Number((await db.query("SELECT seq FROM atokore_private.records WHERE id=$1",[item])).rows[0].seq)>seq0,'other phones see the change');
   // A refused undo (expired) changes neither stock nor estimate.
   await db.query("UPDATE atokore_private.purchase_clock_tickets_v51 SET issued_at=now()-interval '11 minutes'");
   await assert.rejects(asUser(db,A,fn,[second.op]),/purchase_undo_expired/);
   assert.equal((await fields(db,item)).tpb2.k,'k-second');
   assert.equal(await qty(db,item),3);
   // A retry of the finished undo changes nothing more.
   assert.equal((await asUser(db,A,fn,[first.op])).undone,0);
   // Work 7th: a stale phone/tab writes the removed entry back -> the write applies, the entry does not.
   const back=await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field:'tpa1',value:{v:1,k:'k-first',q:2,d:'2026-11-27'}}]});
   assert.equal(back.results[0].status,'applied');
   assert.equal((await fields(db,item)).tpa1,undefined,'never back in the estimate');
   // A NEW purchase entry in the same field name with another k is not blocked.
   await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field:'tpa1',value:{v:1,k:'k-new',q:1,d:'2026-11-27'}}]});
   assert.equal((await fields(db,item)).tpa1.k,'k-new');
   await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:item,field:'tpa1',value:null}]});
  }
 }finally{await db.close()}
});
test('E rollback alone: dropping the guard, the tickets and the RPCs restores the earlier behaviour; receipts kept',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:900});
  const ops=(await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c;
  await db.exec(P('rollback/atokore-purchase-undo-window-v51.rollback.sql'));
  assert.equal((await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c,ops);
  assert.equal((await db.query("SELECT to_regprocedure('atokore_private.trial_allowed_v51(uuid)') IS NOT NULL k")).rows[0].k,true,'shared allowlist kept');
  assert.equal((await asUser(db,A,'hh_undo_purchases',[p.op])).undone,1,'as before the unit');
  await db.exec(P('atokore-purchase-undo-window-v51.sql'));                 // apply again: idempotent re-apply
  const q=await bought(db,A,{ageS:900});
  await assert.rejects(asUser(db,A,'hh_undo_purchases',[q.op]),/purchase_undo_expired/);
 }finally{await db.close()}
});
