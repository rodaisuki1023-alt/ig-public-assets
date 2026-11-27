// v51 proposal: the purchase-undo window as a SEPARATE RPC for synthetic trial households only.
// The existing hh_undo_purchases is never replaced. Isolated PGlite only; never a real project.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-purchase-undo-window-v51.sql'),'utf8');
const A='00000000-0000-4000-8000-0000000001a1',R='00000000-0000-4000-8000-0000000001e1';
let n=0;const oid=()=>'20000000-0000-4000-8000-'+String(++n).padStart(12,'0');
const MIN=60000;
// A purchase that reached the server `ageS` seconds ago. Work 8th: the window is measured from the server's
// receipt of the dedicated purchase command (hh_push_v51 listing the op); via:'sync' = ordinary sync (the
// offline outbox, an older app): no receipt, unprovable. Real households answer not_enabled to the command,
// so they always buy through the ordinary sync.
async function bought(db,uid,{ageS,via='command'}){
 const item='item-qa-'+n,buy='buy-qa-'+n;
 await call(db,uid,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()},{op_id:oid(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()}]});
 const at=Date.now()-ageS*1000,done={op_id:oid(),type:'complete_buy',buy,item,delta:2,ts:at};
 const r=via==='command'?await call(db,uid,'hh_push_v51',{p_ops:[done],p_receipt_ops:[done.op_id]}):null;
 if(!r||r.status==='not_enabled')await call(db,uid,'hh_push',{p_ops:[done]});
 await db.query("UPDATE atokore_private.ops SET at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 await db.query("UPDATE atokore_private.purchase_receipts_v51 SET received_at=to_timestamp($1/1000.0) WHERE op_id=$2",[at,done.op_id]);
 return {op:done.op_id,item,buy};
}
const state=async(db,uid,id)=>(await call(db,uid,'hh_pull',{p_since:0})).records.find(r=>r.id===id);
const undo=(db,uid,ops)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return (await tx.query('select public.hh_undo_purchases_v51($1::jsonb) r',[JSON.stringify(ops)])).rows[0].r});
const baseDef=async db=>(await db.query("SELECT md5(prosrc) h FROM pg_proc WHERE proname='hh_undo_purchases' AND pronamespace='public'::regnamespace")).rows[0].h;
async function fixture(){
 const db=await createDb();const before=await baseDef(db);await db.exec(SQL);
 assert.equal(await baseDef(db),before,'the existing hh_undo_purchases is not replaced');
 await call(db,A,'hh_create',{p_name:'QA undo window',p_display_name:'A'});
 await call(db,R,'hh_create',{p_name:'real',p_display_name:'R'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'QA undo' FROM atokore_private.households WHERE name='QA undo window'");
 return db;
}
test('trial household: 9:59 undoes; 10:00 and 10:01 are refused and change nothing',async()=>{
 const db=await fixture();
 try{
  // Measured from the server's receipt of the purchase.
  const ok=await bought(db,A,{ageS:599});
  {const r=await undo(db,A,[ok.op]);assert.deepEqual([r.undone,r.status],[1,'ready'])}
  assert.equal(Number((await state(db,A,ok.item)).qty),1);assert.equal((await state(db,A,ok.buy)).deleted,false);
  for(const age of [600,601]){
   const p=await bought(db,A,{ageS:age});
   await assert.rejects(undo(db,A,[p.op]),/purchase_undo_expired/);
   assert.equal(Number((await state(db,A,p.item)).qty),3,'stock stays as bought');
   assert.equal((await state(db,A,p.buy)).deleted,true,'the shopping row stays bought');
  }
 }finally{await db.close()}
});
test('offline and delayed (Work 8th): only the server receipt opens a window; the offline outbox and the phone cannot',async()=>{
 const db=await fixture();
 try{
  // Bought offline and sent by the ordinary sync after reconnecting a second ago: no receipt -> unprovable.
  const late=await bought(db,A,{ageS:1,via:'sync'});
  await assert.rejects(undo(db,A,[late.op]),/purchase_undo_unprovable/);
  assert.equal(Number((await state(db,A,late.item)).qty),3);
  // Received through the command 9:30 ago -> still allowed.
  const near=await bought(db,A,{ageS:570});
  assert.equal((await undo(db,A,[near.op])).undone,1);
 }finally{await db.close()}
});
test('a batch with one expired purchase changes nothing; a finished undo still answers its retry after the window',async()=>{
 const db=await fixture();
 try{
  const fresh=await bought(db,A,{ageS:30}),old=await bought(db,A,{ageS:900});
  await assert.rejects(undo(db,A,[fresh.op,old.op]),/purchase_undo_expired/);
  assert.equal(Number((await state(db,A,fresh.item)).qty),3,'the fresh one is not undone half-way');
  assert.equal((await undo(db,A,[fresh.op])).undone,1);
  await db.query("UPDATE atokore_private.purchase_receipts_v51 SET received_at=now()-interval '1 hour'");
  {const r=await undo(db,A,[fresh.op]);assert.deepEqual([r.undone,r.status],[0,'ready'])}
  // The receipts and the history are kept (nothing is deleted by the window).
  const kinds=(await db.query("SELECT type FROM atokore_private.ops WHERE type IN ('complete_buy','undo_purchase') ORDER BY at")).rows.map(r=>r.type);
  assert.ok(kinds.filter(k=>k==='complete_buy').length>=2&&kinds.includes('undo_purchase'));
 }finally{await db.close()}
});
test('a real (non-trial) household gets not_enabled and nothing changes; the existing RPC still works for it',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,R,{ageS:30});
  assert.deepEqual(await undo(db,R,[p.op]),{status:'not_enabled'});
  assert.equal(Number((await state(db,R,p.item)).qty),3);
  assert.equal((await call(db,R,'hh_undo_purchases',{p_ops:[p.op]})).undone,1,'the existing behaviour is unchanged');
  for(const role of ['anon'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.hh_undo_purchases_v51(jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
 }finally{await db.close()}
});
test('rollback: dropping the new RPC leaves the existing one, the receipts and the history as they were',async()=>{
 const db=await fixture();
 try{
  const p=await bought(db,A,{ageS:30});
  const ops=(await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c;
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/proposals/rollback/atokore-purchase-undo-window-v51.rollback.sql'),'utf8'));
  assert.equal((await db.query('SELECT count(*)::int c FROM atokore_private.ops')).rows[0].c,ops);
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[p.op]})).undone,1);
 }finally{await db.close()}
});
