// v51 E (Work 6th): the 10-minute window holds on EVERY entry for trial households: the old RPC
// (hh_undo_purchases) could still undo an expired purchase. Device times that are missing, malformed or
// ahead of the server are not trusted. Isolated PGlite only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000002a1',R='00000000-0000-4000-8000-0000000002e1';
let n=0;const oid=()=>'30000000-0000-4000-8000-'+String(++n).padStart(12,'0');
async function bought(db,uid,{ageS,devS=0,ts}){
 const item='item-qe-'+n,buy='buy-qe-'+n;
 await call(db,uid,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()},{op_id:oid(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()}]});
 const at=Date.now()-ageS*1000,done={op_id:oid(),type:'complete_buy',buy,item,delta:2,ts:at-devS*1000};
 await call(db,uid,'hh_push',{p_ops:[done]});
 await db.query("UPDATE atokore_private.ops SET at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 if(ts!==undefined)await db.query("UPDATE atokore_private.ops SET body=CASE WHEN $2::jsonb IS NULL THEN body-'ts' ELSE jsonb_set(body,'{ts}',$2::jsonb) END WHERE op_id=$1",[done.op_id,ts===null?null:JSON.stringify(ts)]);
 return {op:done.op_id,item,buy};
}
const qty=async(db,id)=>Number((await db.query("SELECT qty FROM atokore_private.records WHERE id=$1",[id])).rows[0].qty);
const asUser=(db,uid,fn,ops)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return (await tx.query('select public.'+fn+'($1::jsonb) r',[JSON.stringify(ops)])).rows[0].r});
async function fixture(){
 const db=await createDb();await db.exec(P('atokore-purchase-undo-window-v51.sql'));
 await call(db,A,'hh_create',{p_name:'QA undo guard',p_display_name:'A'});
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
test('E: both RPCs share the boundary 9:59 ok / 10:00 and 10:01 refused',async()=>{
 const db=await fixture();
 try{
  for(const fn of ['hh_undo_purchases','hh_undo_purchases_v51']){
   const ok=await bought(db,A,{ageS:599});
   assert.equal((await asUser(db,A,fn,[ok.op])).undone,1,fn+' 9:59');
   for(const age of [600,601]){const p=await bought(db,A,{ageS:age});await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_expired/,fn+' '+age);assert.equal(await qty(db,p.item),3)}
  }
 }finally{await db.close()}
});
test('E: untrusted device times are refused on every entry (missing, malformed, ahead of the server)',async()=>{
 const db=await fixture();
 try{
  for(const fn of ['hh_undo_purchases','hh_undo_purchases_v51']){
   for(const ts of [null,'abc',1.5,-1,{x:1}]){
    const p=await bought(db,A,{ageS:30,ts});
    await assert.rejects(asUser(db,A,fn,[p.op]),/purchase_undo_time_invalid/,fn+' ts='+JSON.stringify(ts));
    assert.equal(await qty(db,p.item),3);
   }
   const ahead=await bought(db,A,{ageS:30,devS:-120});                  // the phone says 2 minutes in the future
   await assert.rejects(asUser(db,A,fn,[ahead.op]),/purchase_undo_time_invalid/);
   const skew=await bought(db,A,{ageS:30,devS:-50});                    // within 60 s of clock skew: fine
   assert.equal((await asUser(db,A,fn,[skew.op])).undone,1);
   const offline=await bought(db,A,{ageS:5,devS:15*60});                 // bought offline 15 min before it arrived
   await assert.rejects(asUser(db,A,fn,[offline.op]),/purchase_undo_expired/);
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
  await db.query("UPDATE atokore_private.ops SET at=now()-interval '1 hour' WHERE op_id=$1",[fresh.op]);
  assert.equal((await asUser(db,A,'hh_undo_purchases',[fresh.op])).undone,0,'a retry of a finished undo still answers');
  const types=(await db.query("SELECT type FROM atokore_private.ops WHERE type IN ('complete_buy','undo_purchase')")).rows.map(r=>r.type);
  assert.equal(types.filter(t=>t==='undo_purchase').length,1);
 }finally{await db.close()}
});
test('E: non-trial households and old clients are unchanged (any age, any device time)',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,R,{ageS:3600,ts:null});
  assert.equal((await asUser(db,R,'hh_undo_purchases',[p.op])).undone,1);
  assert.deepEqual(await asUser(db,R,'hh_undo_purchases_v51',[(await bought(db,R,{ageS:30})).op]),{status:'not_enabled'});
 }finally{await db.close()}
});
test('E rollback alone: dropping the guard and the RPC restores the earlier behaviour; receipts kept',async()=>{
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
