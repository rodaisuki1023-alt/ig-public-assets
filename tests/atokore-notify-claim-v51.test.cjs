// v51 C (Work 6th): a queued notice is handed to exactly one sender at a time, re-authorized right
// before sending, and never sent twice after an ambiguous answer. Isolated PGlite; nothing is sent:
// the only "provider" is a synthetic adapter that records calls in memory.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createDb,call}=require('./household/pg.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-buy-assignment-v51.sql'),'utf8');
const sender=import('../supabase/proposals/notify-sender-v51.mjs').catch(()=>({}));
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2';
let n=0;const op=()=>'00000000-0000-4000-9000-'+String(++n).padStart(12,'0');
async function fixture(){
 const db=await createDb();await db.exec(SQL);
 const h=(await call(db,A,'hh_create',{p_name:'QA notify',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA notify')",[h]);
 await call(db,A,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'buy',id:'buy_milk_0001',qty:1,fields:{name:'牛乳',unit:'本'},ts:Date.now()}]});
 await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:0});
 const sql=async(fn,args=[])=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');
  return (await tx.query('SELECT atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows})).at(0).r;
 const row=async()=>(await db.query('SELECT * FROM atokore_private.notify_outbox ORDER BY created_at DESC LIMIT 1')).rows[0];
 return {db,h,sql,row};
}
// A synthetic provider: never reaches a network. `idempotent` adapters de-duplicate by key, like a
// provider that documents an idempotency key; `answers` scripts each call's outcome.
function synthetic({idempotent=true,answers=[]}={}){
 const delivered=new Map(),calls=[];
 return {synthetic:true,idempotent,calls,delivered,
  async send(m){calls.push(m);const a=answers.shift()||'delivered';
   if(a==='delivered'||a==='lost_after_delivery'){if(!idempotent||!delivered.has(m.key))delivered.set(m.key,(delivered.get(m.key)||0)+1);}
   if(a==='lost_after_delivery'||a==='timeout')throw Error('timeout');
   if(a==='rejected')return {status:'rejected'};
   return {status:'delivered'};}};
}
test('C regression (Work 6th): an unsent notice cannot be fetched twice while the first sender holds it',async()=>{
 const {db,sql}=await fixture();
 try{
  const first=await sql('notify_due_v51',[10]);
  assert.equal(first.length,1);
  assert.deepEqual(await sql('notify_due_v51',[10]),[],'a second sender gets nothing while the first holds it');
 }finally{await db.close()}
});
test('C: the reservation is atomic under two concurrent senders (one claim each notice)',async()=>{
 const {db,sql}=await fixture();
 try{
  const [x,y]=await Promise.all([sql('notify_claim_v51',[10,60]),sql('notify_claim_v51',[10,60])]);
  assert.equal(x.length+y.length,1);
  const c=[...x,...y][0];
  assert.match(c.token,/^[0-9a-f-]{36}$/);assert.equal(c.idempotency_key,c.id);assert.equal(c.in_doubt,false);assert.equal(c.attempt,1);
  for(const role of ['anon','authenticated'])for(const fn of ['notify_claim_v51(integer,integer)','notify_authorize_v51(text,uuid)','notify_complete_v51(text,uuid,text)','notify_due_v51(integer)'])
   assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,'atokore_private.'+fn])).rows[0].ok,false,role+' '+fn);
 }finally{await db.close()}
});
test('C: an expired lease is taken over; the old holder cannot authorize any more',async()=>{
 const {db,sql}=await fixture();
 try{
  const [c]=await sql('notify_claim_v51',[10,60]);
  await db.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second'");
  const [d]=await sql('notify_claim_v51',[10,60]);
  assert.equal(d.id,c.id);assert.notEqual(d.token,c.token);assert.equal(d.attempt,2);assert.equal(d.in_doubt,false,'never authorized: nothing could have been sent');
  assert.deepEqual(await sql('notify_authorize_v51',[c.id,c.token]),{ok:false,why:'not_owner'});
  assert.equal((await sql('notify_authorize_v51',[d.id,d.token])).ok,true);
  await db.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second'");
  assert.deepEqual(await sql('notify_authorize_v51',[d.id,d.token]),{ok:false,why:'lease_expired'},'a late sender does not send');
 }finally{await db.close()}
});
test('C: re-authorized right before sending (left, reassigned, deleted, trial removed)',async()=>{
 const {db,sql,h}=await fixture();
 try{
  // Reassigned after the claim: the held notice is stale at authorization and dropped.
  let [c]=await sql('notify_claim_v51',[10,60]);
  await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:null,p_expected_rev:1});
  assert.deepEqual(await sql('notify_authorize_v51',[c.id,c.token]),{ok:false,why:'stale'});
  await call(db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:2});
  // Trial allowlist removed after the claim: refused, kept for later (not dropped).
  [c]=await sql('notify_claim_v51',[10,60]);
  await db.query('DELETE FROM atokore_private.trial_households_v51');
  assert.deepEqual(await sql('notify_authorize_v51',[c.id,c.token]),{ok:false,why:'not_enabled'});
  assert.deepEqual(await sql('notify_claim_v51',[10,60]),[],'a household outside the trial is never claimed');
  await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA notify')",[h]);
  // The recipient leaves after the claim (the trigger drops it; authorize sees it dropped).
  await call(db,B,'hh_leave',{});
  assert.deepEqual(await sql('notify_authorize_v51',[c.id,c.token]),{ok:false,why:'dropped'});
 }finally{await db.close()}
});
test('C: complete is idempotent; a definite rejection retries later; an ambiguous answer is held',async()=>{
 const {db,sql,row}=await fixture();
 try{
  let [c]=await sql('notify_claim_v51',[10,60]);
  assert.equal(await sql('notify_complete_v51',[c.id,c.token,'sent']),'not_authorized','no delivery report without authorization');
  await sql('notify_authorize_v51',[c.id,c.token]);
  assert.equal(await sql('notify_complete_v51',[c.id,c.token,'failed']),'retry_scheduled');
  assert.deepEqual(await sql('notify_claim_v51',[10,60]),[],'backoff: not claimed again at once');
  await db.query("UPDATE atokore_private.notify_outbox SET next_attempt_at=now()-interval '1 second'");
  [c]=await sql('notify_claim_v51',[10,60]);assert.equal(c.in_doubt,false);
  await sql('notify_authorize_v51',[c.id,c.token]);
  assert.equal(await sql('notify_complete_v51',[c.id,c.token,'ambiguous']),'held_for_review');
  await db.query("UPDATE atokore_private.notify_outbox SET lease_until=NULL,next_attempt_at=NULL");
  assert.deepEqual(await sql('notify_claim_v51',[10,60]),[],'an ambiguous notice is never reclaimed automatically');
  // A late delivery report of that attempt is still recorded (it only stops further sends).
  assert.equal(await sql('notify_complete_v51',[c.id,c.token,'sent']),'marked');
  assert.equal(await sql('notify_complete_v51',[c.id,'00000000-0000-4000-8000-000000000000','sent']),'already_sent');
  assert.ok((await row()).sent_at);
  await assert.rejects(sql('notify_complete_v51',[c.id,c.token,'maybe']),/notify_result_invalid/);
 }finally{await db.close()}
});
test('C: a crashed sender after authorization -> the next claim is in doubt',async()=>{
 const {db,sql}=await fixture();
 try{
  const [c]=await sql('notify_claim_v51',[10,60]);
  await sql('notify_authorize_v51',[c.id,c.token]);                // ... then the process dies
  await db.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second'");
  const [d]=await sql('notify_claim_v51',[10,60]);
  assert.equal(d.in_doubt,true);
  // After too many attempts a notice is given up, never resent forever.
  await db.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second',attempts=5");
  assert.deepEqual(await sql('notify_claim_v51',[10,60]),[]);
  const r=(await db.query('SELECT dropped_at IS NOT NULL d,drop_reason FROM atokore_private.notify_outbox')).rows[0];
  assert.deepEqual(r,{d:true,drop_reason:'gave_up'});
 }finally{await db.close()}
});
test('sender: an unverified provider is never used (no claim, no send)',async()=>{
 const {db,sql,row}=await fixture();
 try{
  const {runNotifySender}=await sender;
  for(const p of [null,{send:async()=>({status:'delivered'})},{synthetic:'yes',idempotent:true,send:async()=>({})},{synthetic:true,send:async()=>({})}]){
   assert.deepEqual(await runNotifySender({sql,provider:p}),{status:'refused',why:'provider_not_verified'});
  }
  assert.equal((await row()).claim_token,null,'nothing was even claimed');
 }finally{await db.close()}
});
test('sender: lost answer after delivery -> idempotent provider retries with the same key (1 delivery); non-idempotent holds',async()=>{
 const f=await fixture();
 try{
  const {runNotifySender}=await sender;
  const p=synthetic({idempotent:true,answers:['lost_after_delivery','delivered']});
  let r=await runNotifySender({sql:f.sql,provider:p});
  assert.deepEqual(r.retry.length,1);
  await f.db.query("UPDATE atokore_private.notify_outbox SET next_attempt_at=now()-interval '1 second'");
  r=await runNotifySender({sql:f.sql,provider:p});
  assert.equal(r.sent.length,1);
  assert.equal(p.calls.length,2);assert.equal(p.calls[0].key,p.calls[1].key,'stable idempotency key');
  assert.deepEqual([...p.delivered.values()],[1],'delivered once');
  assert.equal((await runNotifySender({sql:f.sql,provider:p})).sent.length,0,'not sent again');
 }finally{await f.db.close()}
 const g=await fixture();
 try{
  const {runNotifySender}=await sender;
  const p=synthetic({idempotent:false,answers:['lost_after_delivery']});
  let r=await runNotifySender({sql:g.sql,provider:p});
  assert.equal(r.held.length,1,'ambiguous: held for review, not resent');
  await g.db.query("UPDATE atokore_private.notify_outbox SET lease_until=NULL,next_attempt_at=NULL");
  r=await runNotifySender({sql:g.sql,provider:p});
  assert.equal(p.calls.length,1,'never a second call');
  // A crash after authorization with a non-idempotent provider: the in-doubt claim is held, not sent.
  await call(g.db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:null,p_expected_rev:1});
  await call(g.db,A,'hh_buy_assign',{p_buy:'buy_milk_0001',p_assignee:B,p_expected_rev:2});
  const [c]=await g.sql('notify_claim_v51',[10,60]);await g.sql('notify_authorize_v51',[c.id,c.token]);
  await g.db.query("UPDATE atokore_private.notify_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[c.id]);
  r=await runNotifySender({sql:g.sql,provider:p});
  assert.deepEqual([r.held.length,p.calls.length],[1,1]);
 }finally{await g.db.close()}
});
test('sender: a definite rejection is retried later and then delivered once',async()=>{
 const {db,sql}=await fixture();
 try{
  const {runNotifySender}=await sender;
  const p=synthetic({idempotent:false,answers:['rejected','delivered']});
  assert.equal((await runNotifySender({sql,provider:p})).retry.length,1);
  await db.query("UPDATE atokore_private.notify_outbox SET next_attempt_at=now()-interval '1 second'");
  assert.equal((await runNotifySender({sql,provider:p})).sent.length,1);
  assert.deepEqual([...p.delivered.values()],[1]);
 }finally{await db.close()}
});
test('C rollback/restore alone: an in-doubt send stays in doubt; reservations are not restored; D untouched',async()=>{
 const {db,sql}=await fixture();
 const P=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
 try{
  const [c]=await sql('notify_claim_v51',[10,60]);await sql('notify_authorize_v51',[c.id,c.token]);
  await db.exec(P('rollback/atokore-buy-assignment-v51.rollback.sql'));
  assert.equal((await db.query("SELECT to_regprocedure('atokore_private.notify_claim_v51(integer,integer)') IS NULL gone")).rows[0].gone,true);
  assert.equal((await db.query("SELECT to_regprocedure('atokore_private.trial_allowed_v51(uuid)') IS NOT NULL kept")).rows[0].kept,true,'shared allowlist kept for D');
  await db.exec(SQL);await db.exec(P('rollback/atokore-buy-assignment-v51.restore.sql'));
  const r=(await db.query('SELECT claim_token,lease_until,send_started_at IS NOT NULL started FROM atokore_private.notify_outbox')).rows[0];
  assert.deepEqual(r,{claim_token:null,lease_until:null,started:true});
  const [d]=await sql('notify_claim_v51',[10,60]);
  assert.equal(d.in_doubt,true);
 }finally{await db.close()}
});
