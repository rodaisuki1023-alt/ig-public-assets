// The five SQL units can each be applied on their own (only on the reviewed migrations) and rolled back
// on their own: C (assignment) and D (prep) each back up their rows, drop only their own objects and keep
// the shared synthetic-trial allowlist; applying again + restore brings the data back. Isolated PGlite.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000003a1',B='00000000-0000-4000-8000-0000000003b1';
let n=0;const op=()=>'40000000-0000-4000-8000-'+String(++n).padStart(12,'0');
async function base(){
 const db=await createDb();
 const h=(await call(db,A,'hh_create',{p_name:'QA units',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await call(db,A,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'buy',id:'buy_units_0001',qty:1,fields:{name:'牛乳',unit:'本'},ts:Date.now()}]});
 return {db,h};
}
const allow=(db,h)=>db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA units') ON CONFLICT DO NOTHING",[h]);
const exists=async(db,reg)=>(await db.query('SELECT to_regclass($1) IS NOT NULL ok',[reg])).rows[0].ok;
const fnExists=async(db,sig)=>(await db.query('SELECT to_regprocedure($1) IS NOT NULL ok',[sig])).rows[0].ok;
const doc={v:1,children:[{id:'c-a',name:'上の子'}],week:{},events:{}};
test('each unit applies alone on the reviewed migrations',async()=>{
 for(const files of [['atokore-photo-gateway-v50.sql','atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql','atokore-photo-legacy-migrate-v51.sql'],
  ['atokore-photo-legacy-close-writes-v51.sql'],['atokore-buy-assignment-v51.sql'],['atokore-prep-share-v51.sql'],['atokore-purchase-undo-window-v51.sql']]){
  const db=await createDb();
  try{for(const f of files)await db.exec(P(f))}finally{await db.close()}
 }
});
test('C rolls back alone: rows backed up, D and the shared allowlist keep working, re-apply + restore brings C back',async()=>{
 const {db,h}=await base();
 try{
  await db.exec(P('atokore-buy-assignment-v51.sql'));await db.exec(P('atokore-prep-share-v51.sql'));await allow(db,h);
  assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_units_0001',p_assignee:B,p_expected_rev:0})).status,'ready');
  assert.equal((await call(db,A,'hh_prep_put',{p_doc:doc,p_expected_rev:0})).status,'ready');
  await db.exec(P('rollback/atokore-buy-assignment-v51.rollback.sql'));
  assert.equal(await exists(db,'atokore_private.buy_assignments'),false);
  assert.equal(await fnExists(db,'public.hh_buy_assign(text,uuid,integer)'),false);
  assert.equal(await exists(db,'atokore_private.trial_households_v51'),true,'shared allowlist kept');
  assert.equal((await db.query('SELECT count(*)::int c FROM atokore_private.rollback_buy_assignments_v51')).rows[0].c,1);
  assert.equal((await call(db,A,'hh_prep_get',{p_day:(await db.query('SELECT current_date::text d')).rows[0].d})).rev,1,'D unaffected');
  // Leaving still works without the C trigger.
  await assert.rejects(db.exec(P('rollback/atokore-buy-assignment-v51.rollback.sql')),/does not exist|assignment_backup_exists/);
  await db.exec('rollback').catch(()=>{});
  await db.exec(P('atokore-buy-assignment-v51.sql'));await db.exec(P('rollback/atokore-buy-assignment-v51.restore.sql'));
  assert.deepEqual((await call(db,A,'hh_buy_assignments')).map(r=>[r.assignee,r.response,r.rev]),[[B,'pending',1]]);
  assert.equal(await exists(db,'atokore_private.rollback_buy_assignments_v51'),false);
  assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy_units_0001',p_decision:'accept',p_expected_rev:1})).status,'ready','restored state is live');
 }finally{await db.close()}
});
test('D rolls back alone: rows backed up, C and the shared allowlist keep working, re-apply + restore brings D back',async()=>{
 const {db,h}=await base();
 try{
  await db.exec(P('atokore-buy-assignment-v51.sql'));await db.exec(P('atokore-prep-share-v51.sql'));await allow(db,h);
  const day=(await db.query('SELECT current_date::text d')).rows[0].d;
  assert.equal((await call(db,A,'hh_prep_put',{p_doc:doc,p_expected_rev:0})).status,'ready');
  await db.exec(P('rollback/atokore-prep-share-v51.rollback.sql'));
  assert.equal(await exists(db,'atokore_private.prep_docs'),false);
  assert.equal(await exists(db,'atokore_private.trial_households_v51'),true);
  assert.equal((await call(db,A,'hh_buy_assign',{p_buy:'buy_units_0001',p_assignee:B,p_expected_rev:0})).status,'ready','C unaffected');
  await db.exec(P('atokore-prep-share-v51.sql'));await db.exec(P('rollback/atokore-prep-share-v51.restore.sql'));
  const got=await call(db,B,'hh_prep_get',{p_day:day});
  assert.equal(got.rev,1);assert.equal(got.doc.children[0].name,'上の子');
  assert.equal((await call(db,A,'hh_prep_put',{p_doc:{...doc,children:[{id:'c-a',name:'上の子2'}]},p_expected_rev:1})).rev,2,'restored revision continues');
 }finally{await db.close()}
});
test('notices: marking sent is idempotent and a dropped notice is never marked sent',async()=>{
 const {db,h}=await base();
 try{
  await db.exec(P('atokore-buy-assignment-v51.sql'));await allow(db,h);
  await call(db,A,'hh_buy_assign',{p_buy:'buy_units_0001',p_assignee:B,p_expected_rev:0});
  const svc=async(sql,args)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query(sql,args)).rows})).at(0).r;
  const [due]=await svc('SELECT atokore_private.notify_due_v51(10) r',[]);
  assert.equal((await svc('SELECT atokore_private.notify_authorize_v51($1,$2) r',[due.id,due.token])).ok,true);
  assert.equal(await svc('SELECT atokore_private.notify_complete_v51($1,$2,$3) r',[due.id,due.token,'sent']),'marked');
  assert.equal(await svc('SELECT atokore_private.notify_complete_v51($1,$2,$3) r',[due.id,due.token,'sent']),'already_sent');
  assert.deepEqual(await svc('SELECT atokore_private.notify_due_v51(10) r',[]),[],'a sent notice is not due again');
  await call(db,A,'hh_buy_assign',{p_buy:'buy_units_0001',p_assignee:null,p_expected_rev:1});
  await call(db,A,'hh_buy_assign',{p_buy:'buy_units_0001',p_assignee:B,p_expected_rev:2});
  await call(db,B,'hh_leave',{});
  const id=(await db.query("SELECT id FROM atokore_private.notify_outbox WHERE sent_at IS NULL")).rows[0].id;
  assert.equal(await svc('SELECT atokore_private.notify_complete_v51($1,$2,$3) r',[id,null,'failed']),'dropped');
  assert.equal(await svc('SELECT atokore_private.notify_complete_v51($1,$2,$3) r',[id,null,'sent']),'not_authorized','a dropped notice is never marked sent');
 }finally{await db.close()}
});
