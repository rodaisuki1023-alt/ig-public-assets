// v51 proposal (Work P1): the server applies the 10-minute purchase-undo window on its own clock.
// Isolated PGlite only; never a real project.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-purchase-undo-window-v51.sql'),'utf8');
const A='00000000-0000-4000-8000-0000000001a1',B='00000000-0000-4000-8000-0000000001b2';
let n=0;const oid=()=>'20000000-0000-4000-8000-'+String(++n).padStart(12,'0');
async function bought(db,ageSeconds){
 const item='item-qa-'+n,buy='buy-qa-'+n;
 await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()},{op_id:oid(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'},ts:Date.now()}]});
 const done={op_id:oid(),type:'complete_buy',buy,item,delta:2};
 await call(db,A,'hh_push',{p_ops:[done]});
 await db.query("UPDATE atokore_private.ops SET at=now()-make_interval(secs=>$1) WHERE op_id=$2",[ageSeconds,done.op_id]);
 return {op:done.op_id,item,buy};
}
const state=async(db,id)=>(await call(db,A,'hh_pull',{p_since:0})).records.find(r=>r.id===id);
async function fixture(){
 const db=await createDb();await db.exec(SQL);
 await call(db,A,'hh_create',{p_name:'QA undo window',p_display_name:'A'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 return db;
}
test('server window: 9:59 undoes; 10:00 and 10:01 are refused and change nothing',async()=>{
 const db=await fixture();
 try{
  const ok=await bought(db,599);
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[ok.op]})).undone,1);
  assert.equal(Number((await state(db,ok.item)).qty),1);assert.equal((await state(db,ok.buy)).deleted,false);
  for(const age of [600,601]){
   const p=await bought(db,age);
   await assert.rejects(call(db,A,'hh_undo_purchases',{p_ops:[p.op]}),/purchase_undo_expired/);
   assert.equal(Number((await state(db,p.item)).qty),3,'stock stays as bought');
   assert.equal((await state(db,p.buy)).deleted,true,'the shopping row stays bought');
   const o=(await db.query("SELECT body->>'_undo_done' d FROM atokore_private.ops WHERE op_id=$1",[p.op])).rows[0];
   assert.equal(o.d,null,'the receipt is not marked undone');
  }
 }finally{await db.close()}
});
test('server window: one expired purchase rolls back the whole batch; a finished undo still answers its retry',async()=>{
 const db=await fixture();
 try{
  const fresh=await bought(db,30),old=await bought(db,900);
  await assert.rejects(call(db,A,'hh_undo_purchases',{p_ops:[fresh.op,old.op]}),/purchase_undo_expired/);
  assert.equal(Number((await state(db,fresh.item)).qty),3,'the fresh one is not undone half-way');
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[fresh.op]})).undone,1);
  // The answer was lost and the phone retries after the deadline: already done, no error, no change.
  await db.query("UPDATE atokore_private.ops SET at=now()-interval '1 hour' WHERE op_id=$1",[fresh.op]);
  assert.equal((await call(db,A,'hh_undo_purchases',{p_ops:[fresh.op]})).undone,0);
  assert.equal(Number((await state(db,fresh.item)).qty),1);
  // Another member still cannot undo someone else's purchase.
  const mine=await bought(db,10);
  await assert.rejects(call(db,B,'hh_undo_purchases',{p_ops:[mine.op]}),/purchase_not_reversible/);
 }finally{await db.close()}
});
test('the proposal only adds the window to the existing function',()=>{
 const base=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261024111736_atokore_polish_v44.sql'),'utf8');
 const body=s=>s.slice(s.indexOf('create or replace function public.hh_undo_purchases'),s.indexOf('grant execute on function public.hh_undo_purchases'));
 const stripped=body(SQL).split('\n').filter(l=>!/^\s*--/.test(l)&&!/purchase_undo_expired/.test(l)).join('\n');
 assert.equal(stripped,body(base));
});
