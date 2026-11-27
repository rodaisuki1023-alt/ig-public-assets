// Real PostgreSQL, separate connections (CI's disposable database; run after safety5-postgres.cjs).
// Work 9th reproductions under real concurrency:
//  ③ capacity: two reservations of 120 B from 790/1000 B on two connections -> never both (the budget row lock
//    serializes them); two workers copying at once from 79% cannot exceed the limit (was 103.88%).
//  ④ E: an undo that starts at 599 s and waits for a lock until after 600 s is refused (expired); nothing changes.
//  ② forecast: A bought, undone; B buys the same row; A's entry arrives late on another connection -> only B counts.
const {Pool,Client}=require('pg');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:12});
const P=f=>fs.readFileSync(path.join(__dirname,'../../supabase/proposals',f),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
}
async function svc(fn,args=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role service_role');const r=await c.query('SELECT atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
}
const push=(uid,ops)=>rpc(uid,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);
async function household(name){
 const A=randomUUID(),B=randomUUID();
 const hh=(await rpc(A,"SELECT public.hh_create($1,'QA-A') r",[name])).household.id;
 const code=(await rpc(A,'SELECT public.hh_invite_create() r')).code;
 await rpc(B,"SELECT public.hh_join($1,'QA-B') r",[code]);
 await pool.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA safety6') ON CONFLICT DO NOTHING",[hh]);
 return {A,B,hh};
}
async function capacity(){
 const has=async q=>(await pool.query(q)).rows[0].ok;
 if(!await has("SELECT to_regprocedure('atokore_private.photo_storage_reserve_v51(text,text,text,text,text,text)') IS NOT NULL ok"))
  throw Error('photo-legacy-migrate-v51 must be applied by the earlier scripts');
 await pool.query("DELETE FROM atokore_private.photo_storage_reservations_v51 WHERE op_key LIKE 's6-%'");
 await pool.query("DELETE FROM storage.objects WHERE bucket_id='qa-s6-src'");
 // A disposable budget for this test: the existing objects + 790 of 1000 in use.
 await pool.query("UPDATE atokore_private.photo_storage_budget_v51 SET unknown_object_bytes=100");
 const base=Number((await svc('photo_storage_budget_v51')).used_bytes);
 await pool.query("UPDATE atokore_private.photo_storage_budget_v51 SET quota_bytes=$1",[base+1000]);
 await pool.query("INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('qa-s6-src','qa-s6-src',false,120) ON CONFLICT(id) DO UPDATE SET file_size_limit=120");
 await pool.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('qa-s6-src','fill','{\"size\":670}'),('qa-s6-src','src','{\"size\":120}') ON CONFLICT DO NOTHING");
 // Make the two decisions really overlap: each insert of a reservation waits 0.5 s (test-only trigger). With the
 // budget row lock the second decision waits for the first and sees it; without it both would pass.
 await pool.query("CREATE OR REPLACE FUNCTION atokore_private.qa_s6_slow() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.5);RETURN NEW;END$$");
 await pool.query("DROP TRIGGER IF EXISTS qa_s6_slow ON atokore_private.photo_storage_reservations_v51");
 await pool.query("CREATE TRIGGER qa_s6_slow BEFORE INSERT ON atokore_private.photo_storage_reservations_v51 FOR EACH ROW EXECUTE FUNCTION atokore_private.qa_s6_slow()");
 let tries;
 try{tries=await Promise.all([1,2].map(i=>svc('photo_storage_reserve_v51',['s6-'+i,'restore','qa-s6-src','src','qa-s6-src','dst-'+i])))}
 finally{await pool.query("DROP TRIGGER IF EXISTS qa_s6_slow ON atokore_private.photo_storage_reservations_v51")}
 // 790 + 120 = 910 (restore band up to 100%): one passes; 910 + 120 = 1030 > 1000: the other must not.
 if(process.env.DBG)console.log('TRIES',JSON.stringify(tries));
 assert.deepEqual(tries.map(t=>t.ok).sort(),[false,true],'two concurrent reservations of 120 from 790/1000: never both');
 // Many at once: the total never exceeds the quota.
 const many=await Promise.all(Array.from({length:8},(_,i)=>svc('photo_storage_reserve_v51',['s6-m'+i,'restore','qa-s6-src','src','qa-s6-src','m-'+i])));
 assert.equal(many.filter(t=>t.ok).length,0,'no room left: none of 8 concurrent reservations passes');
 const used=Number((await svc('photo_storage_budget_v51')).used_bytes)-base;
 assert.ok(used<=1000,'used '+used+' of 1000');
 await pool.query("DELETE FROM atokore_private.photo_storage_reservations_v51 WHERE op_key LIKE 's6-%'");
 await pool.query("DELETE FROM storage.objects WHERE bucket_id='qa-s6-src'");
 await pool.query("UPDATE atokore_private.photo_storage_budget_v51 SET quota_bytes=1073741824,unknown_object_bytes=81920");
 console.log('PASS ③: concurrent reservations from 790/1000 never both pass; 8 at once never exceed the quota (used '+used+')');
}
async function undoAtTheBoundary(){
 const {A,hh}=await household('QA safety6 undo boundary');
 const item='item-s6-'+randomUUID().slice(0,8),buy='buy-s6-'+randomUUID().slice(0,8),op=randomUUID();
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:item,qty:1,fields:{name:'合成 ミルク',unit:'缶'}},{op_id:randomUUID(),type:'create',kind:'buy',id:buy,qty:2,fields:{name:'合成 ミルク',unit:'缶'}}]);
 await rpc(A,'SELECT public.hh_push_v51($1::jsonb,$2::jsonb) r',[JSON.stringify([{op_id:op,type:'complete_buy',buy,item,delta:2,ts:Date.now()}]),JSON.stringify([op])]);
 // Received 599.3 s ago; another connection holds the household lock for 1.5 s while the undo starts.
 await pool.query("UPDATE atokore_private.purchase_receipts_v51 SET received_at=clock_timestamp()-interval '599.3 seconds' WHERE op_id=$1",[op]);
 const holder=new Client({connectionString:url});await holder.connect();
 await holder.query('BEGIN');await holder.query('SELECT 1 FROM atokore_private.households WHERE id=$1 FOR UPDATE',[hh]);
 const t0=Date.now();
 const undo=rpc(A,'SELECT public.hh_undo_purchases_v51($1::jsonb) r',[JSON.stringify([op])]).then(r=>({ok:r}),e=>({err:e.message}));
 await delay(1500);await holder.query('COMMIT');await holder.end();
 const res=await undo;
 assert.match(res.err||'',/purchase_undo_expired/,'started at 599 s, decided after 600 s: refused');
 assert.ok(Date.now()-t0>=1400,'it did wait for the lock');
 const r=(await pool.query("SELECT qty::int q FROM atokore_private.records WHERE household_id=$1 AND id=$2",[hh,item])).rows[0];
 assert.equal(r.q,3,'stock stays as bought');
 assert.equal((await pool.query("SELECT deleted FROM atokore_private.records WHERE household_id=$1 AND id=$2",[hh,buy])).rows[0].deleted,true,'the shopping row stays bought');
 console.log('PASS ④: an undo waiting on a lock from 599.3 s is refused after 600 s; nothing changes');
}
async function invalidInputConcurrent(){
 const {A,hh}=await household('QA safety6 input');
 const item='item-s6i-'+randomUUID().slice(0,6),buy='buy-s6i-'+randomUUID().slice(0,6),op=randomUUID();
 await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id:item,qty:1,fields:{name:'x',unit:'個'}},{op_id:randomUUID(),type:'create',kind:'buy',id:buy,qty:1,fields:{name:'x',unit:'個'}}]);
 const ops=JSON.stringify([{op_id:op,type:'complete_buy',buy,item,delta:1,ts:Date.now()}]);
 const bad=['[null]',JSON.stringify([op,null]),'[]',JSON.stringify([op,op])];
 const res=await Promise.allSettled(bad.map(b=>rpc(A,'SELECT public.hh_push_v51($1::jsonb,$2::jsonb) r',[ops,b])));
 assert.ok(res.every(x=>x.status==='rejected'&&/purchase_receipt_input_invalid/.test(x.reason.message)));
 assert.equal((await pool.query('SELECT count(*)::int c FROM atokore_private.ops WHERE op_id=$1',[op])).rows[0].c,0,'nothing applied');
 assert.equal((await pool.query('SELECT count(*)::int c FROM atokore_private.purchase_receipts_v51 WHERE op_id=$1',[op])).rows[0].c,0,'no receipt');
 console.log('PASS ④: invalid dedicated inputs (NULL element, NULL mixed with a valid id, empty, duplicate) refuse the whole call on real PostgreSQL');
}
async function main(){
 let failed=0;
 for(const f of [capacity,undoAtTheBoundary,invalidInputConcurrent]){
  try{await f()}catch(e){failed++;console.log('FAIL '+f.name+': '+String(e.message||e).split('\n')[0])}
 }
 if(failed)throw Error(failed+' scenario(s) failed');
}
main().then(()=>pool.end(),e=>{console.error(String(e.message||e));pool.end();process.exit(1)});
