// Runs only on the isolated PostgreSQL/PGlite fixture. No real Supabase or Storage.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDb,call}=require('./household/pg.cjs');
const proposal=fs.readFileSync(path.join(__dirname,'../supabase/proposals/atokore-photo-reservation-v50.sql'),'utf8');
const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002', C='00000000-0000-4000-8000-000000000003';
const SA='00000000-0000-4000-9000-000000000001', SB='00000000-0000-4000-9000-000000000002', SC='00000000-0000-4000-9000-000000000003';
let n=0;
const op=()=>('00000000-0000-4000-8000-'+String(++n+100).padStart(12,'0'));
const record=i=>'photo_item_'+i;
async function fixture(){
 const db=await createDb();
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);');
 for(const [id,u] of [[SA,A],[SB,B],[SC,C]])await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[id,u]);
 await db.exec(proposal);
 const h=(await call(db,A,'hh_create',{p_name:'QA reserve A',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');
 await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 const hc=(await call(db,C,'hh_create',{p_name:'QA reserve C',p_display_name:'C'})).household.id;
 for(let i=0;i<5;i++){
  const res=await call(db,A,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'item',id:record(i),qty:1,fields:{name:'合成'+i,unit:'個'},ts:Date.now()}]});
  assert.equal(res.results[0].status,'applied');
 }
 const reserve=(uid,sid,r,o,expected=null,household=h)=>db.transaction(async tx=>{
  await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,session_id:sid})]);
  return (await tx.query('SELECT atokore_private.photo_reserve_v50($1,$2,$3,$4) r',[household,r,o,expected])).rows[0].r;
 });
 return {db,h,hc,reserve};
}
test('private reservation table and function are not client-callable',async()=>{
 const {db}=await fixture();
 try{
  for(const role of ['anon','authenticated']){
   const q=await db.query("SELECT has_table_privilege($1,'atokore_private.photo_ledger_v50','SELECT') AS readable, has_table_privilege($1,'atokore_private.photo_ledger_v50','INSERT') AS writable, has_function_privilege($1,'atokore_private.photo_reserve_v50(uuid,text,uuid,text)','EXECUTE') AS callable",[role]);
   assert.deepEqual(q.rows[0],{readable:false,writable:false,callable:false});
  }
 }finally{await db.close()}
});
test('reserve enforces session, membership, exact item, expected reference and idempotency',async()=>{
 const {db,reserve}=await fixture();
 try{
  const o=op();
  const a=await reserve(A,SA,record(0),o);
  assert.equal(a.eligible,true);assert.equal(a.reused,false);
  const retry=await reserve(A,SA,record(0),o);
  assert.equal(retry.file_id,a.file_id);assert.equal(retry.reused,true);
  assert.equal(retry.expires_at,a.expires_at);
  await assert.rejects(reserve(B,SB,record(0),o),/photo_operation_conflict/);
  await assert.rejects(reserve(A,SA,record(0),op()),/photo_pending_item/);
  await assert.rejects(reserve(C,SC,record(1),op()),/photo_denied/);
  await assert.rejects(reserve(A,SB,record(1),op()),/photo_denied/);
  await assert.rejects(reserve(A,SA,'missing_item',op()),/photo_denied/);
  await assert.rejects(reserve(A,SA,record(1),op(),'old.jpg'),/photo_stale_reference/);
  await db.query("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",[SB]);
  await assert.rejects(reserve(B,SB,record(1),op()),/photo_denied/);
  await db.query("UPDATE auth.sessions SET not_after=NULL WHERE id=$1",[SB]);
  await call(db,A,'hh_remove_member',{p_user:B});
  await assert.rejects(reserve(B,SB,record(1),op()),/photo_denied/);
 }finally{await db.close()}
});
test('expired reservations remain charged; three pending cap does not auto-reuse old paths',async()=>{
 const {db,h,reserve}=await fixture();
 try{
  const o=op(), a=await reserve(A,SA,record(0),o);
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET expires_at=now()-interval '1 second' WHERE file_id=$1",[a.file_id]);
  assert.equal((await reserve(A,SA,record(0),o)).eligible,false);
  await reserve(A,SA,record(1),op());await reserve(A,SA,record(2),op());
  await assert.rejects(reserve(A,SA,record(3),op()),/photo_pending_limit/);
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE household_id=$1",[h]);
  const b=await reserve(A,SA,record(0),op());assert.notEqual(a.file_id,b.file_id);
 }finally{await db.close()}
});
test('retired and purging rows count toward 50-photo household cap; purged rows do not',async()=>{
 const {db,h,reserve}=await fixture();
 try{
  await db.query("INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,state,expires_at) SELECT $1,'retired_'||i,$2,gen_random_uuid(),CASE WHEN i=1 THEN 'purging' ELSE 'retired' END,now() FROM generate_series(1,50) i",[h,A]);
  await assert.rejects(reserve(A,SA,record(0),op()),/photo_quota/);
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET state='purged' WHERE household_id=$1 AND record_id='retired_1'",[h]);
  assert.equal((await reserve(A,SA,record(0),op())).eligible,true);
 }finally{await db.close()}
});
test('global cap includes retired rows across households',async()=>{
 const {db,h,hc,reserve}=await fixture();
 try{
  await db.query("INSERT INTO atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,state,expires_at) SELECT $1,'retired_'||i,$2,gen_random_uuid(),'retired',now() FROM generate_series(1,1280) i",[hc,C]);
  await assert.rejects(reserve(A,SA,record(0),op()),/photo_quota/);
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET state='purged' WHERE household_id=$1 AND record_id='retired_1'",[hc]);
  assert.equal((await reserve(A,SA,record(0),op())).eligible,true);
 }finally{await db.close()}
});

// v51 owner policy: shared cloud photos per household, free 5 / premium 20 (device-only photos are
// not counted). One slot per product; replacing a product's photo takes no new slot; a downgrade
// keeps every existing photo and only refuses photos for further products.
async function planFixture(count){
 const f=await fixture();
 for(let i=5;i<count;i++){
  const res=await call(f.db,A,'hh_push',{p_ops:[{op_id:op(),type:'create',kind:'item',id:record(i),qty:1,fields:{name:'合成'+i,unit:'個'},ts:Date.now()}]});
  assert.equal(res.results[0].status,'applied');
 }
 // Attach directly: the lifecycle (upload/finish/attach) is covered by its own tests.
 f.attach=async r=>{const res=await f.reserve(A,SA,r,op());await f.db.query("UPDATE atokore_private.photo_ledger_v50 SET state='attached',actual_bytes=40000 WHERE file_id=$1",[res.file_id]);return res};
 return f;
}
test('free household: the sixth product photo is refused, a replacement at the limit is not',async()=>{
 const {db,h,attach,reserve}=await planFixture(7);
 for(let i=0;i<5;i++)await attach(record(i));
 await assert.rejects(reserve(A,SA,record(5),op()),/photo_plan_limit/);
 await assert.rejects(reserve(B,SB,record(6),op()),/photo_plan_limit/,'any member, same household limit');
 const replacing=await reserve(A,SA,record(2),op(),null);
 assert.equal(replacing.eligible,true);
 // Nothing was deleted or changed by the refusals.
 const rows=(await db.query("SELECT state,count(*)::int n FROM atokore_private.photo_ledger_v50 WHERE household_id=$1 GROUP BY state ORDER BY state",[h])).rows;
 assert.deepEqual(rows,[{state:'attached',n:5},{state:'reserved',n:1}]);
});
test('pending uploads hold a slot, so a burst cannot pass the limit; retired photos free it',async()=>{
 const {db,h,attach,reserve}=await planFixture(7);
 for(let i=0;i<3;i++)await attach(record(i));
 await reserve(A,SA,record(3),op());await reserve(B,SB,record(4),op());
 await assert.rejects(reserve(A,SA,record(5),op()),/photo_plan_limit/,'3 attached + 2 pending = 5');
 // A product's old photo retired after replacement or deletion no longer occupies its slot.
 await db.query("UPDATE atokore_private.photo_ledger_v50 SET state='retired' WHERE household_id=$1 AND record_id=$2",[h,record(0)]);
 assert.equal((await reserve(A,SA,record(5),op())).eligible,true);
});
test('premium allows 20 product photos; the 21st is refused',async()=>{
 const {db,h,attach,reserve}=await planFixture(22);
 await db.query("UPDATE atokore_private.households SET plan='premium',plan_expires_at=NULL WHERE id=$1",[h]);
 for(let i=0;i<20;i++)await attach(record(i));
 await assert.rejects(reserve(A,SA,record(20),op()),/photo_plan_limit/);
});
test('after the paid plan ends, existing photos stay, replacements work, new products are refused',async()=>{
 const {db,h,hc,attach,reserve}=await planFixture(14);
 await db.query("UPDATE atokore_private.households SET plan='premium',plan_expires_at=NULL WHERE id=$1",[h]);
 for(let i=0;i<12;i++)await attach(record(i));
 await db.query("UPDATE atokore_private.households SET plan_expires_at=now()-interval '1 day' WHERE id=$1",[h]);
 await assert.rejects(reserve(A,SA,record(12),op()),/photo_plan_limit/);
 assert.equal((await reserve(A,SA,record(4),op(),null)).eligible,true,'replacing an existing photo');
 assert.equal((await db.query("SELECT count(*)::int n FROM atokore_private.photo_ledger_v50 WHERE household_id=$1 AND state='attached'",[h])).rows[0].n,12,'nothing deleted');
 // Another household's photos never count against this one.
 assert.equal((await db.query('SELECT atokore_private.cloud_photo_limit_v51(atokore_private.effective_plan($1)) n',[hc])).rows[0].n,5);
});
test('the photo limit is not a consumable usage feature',async()=>{
 const {db}=await fixture();
 const r=await call(db,A,'hh_consume',{p_feature:'cloud_photos',p_event_key:'qa-cloud-photo-1'});
 assert.equal(r.status,'rejected:unknown_feature');
 for(const role of ['anon','authenticated'])
  assert.equal((await db.query("SELECT has_function_privilege($1,'atokore_private.cloud_photo_limit_v51(text)','EXECUTE') ok",[role])).rows[0].ok,false);
});
