// Real PostgreSQL, separate connections, actual row-lock waits. CI's disposable database only.
// PGlite covers the other SQL rules but cannot prove these races.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:16});
const A=randomUUID(),B=randomUUID(),D=randomUUID();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function call(uid,sql,params=[]){
 const c=await pool.connect();try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);const r=await c.query(sql,params);await c.query('commit');return r.rows[0]?.r}catch(e){await c.query('rollback');throw e}finally{c.release()}
}
async function main(){
 await pool.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=path.resolve(__dirname,'../../supabase/migrations');
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')).sort())await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
 const h=await call(A,"select public.hh_create('QA locks','QA-A') r");const hh=h.household.id;
 const inv=await call(A,'select public.hh_invite_create() r');await call(B,'select public.hh_join($1,$2) r',[inv.code,'QA-B']);
 for(const action of ["select public.hh_push('[]') r","select public.hh_invite_create() r","select public.hh_invite_revoke() r","select public.hh_consume('server_receipt_reads','qa-race-event') r"]){
  await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);
  const owner=await pool.connect(),member=await pool.connect();
  try{
   await owner.query('begin');await owner.query('select id from atokore_private.households where id=$1 for update',[hh]);
   await owner.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
   await member.query('begin');await member.query('set local role authenticated');await member.query("select set_config('request.jwt.claim.sub',$1,true)",[B]);
   // Attach rejection handling immediately; the promise must remain live while we observe its lock.
   const pending=member.query(action).then(value=>({value}),error=>({error}));
   let blocked=false;
   for(let n=0;n<200;n++){
    const r=await pool.query('select cardinality(pg_blocking_pids($1))>0 as blocked',[member.processID]);
    if(r.rows[0].blocked){blocked=true;break}await delay(20);
   }
   assert.equal(blocked,true,'member RPC must actually wait behind the household lock');
   await owner.query('select public.hh_remove_member($1)',[B]);await owner.query('commit');
   const result=await pending;assert.equal(result.error?.code,'42501',action+' must recheck removal after waiting');
   await member.query('rollback');console.log('PASS queued revocation: '+action);
  }finally{await owner.query('rollback');await member.query('rollback');owner.release();member.release()}
 }
 // Multiple failed joins are serialized for one account, so concurrent calls cannot bypass 10/hour.
 const attempts=await Promise.all(Array.from({length:12},()=>call(D,"select public.hh_join('ZZZZZZZZ','QA-D') r").then(r=>r.error,e=>e.message)));
 assert.equal(attempts.filter(x=>x==='invalid_code').length,10);assert.equal(attempts.filter(x=>x==='too_many_attempts').length,2);
 console.log('PASS concurrent join rate limit');
 await pool.query('update atokore_private.members set left_at=null where household_id=$1 and user_id=$2',[hh,B]);
 const op={op_id:randomUUID(),type:'create',kind:'item',id:'qa-counter-stock',fields:{name:'QA wipes'},qty:3};
 await call(A,'select public.hh_push($1::jsonb) r',[JSON.stringify([op])]);
 await Promise.all([A,B].map(uid=>call(uid,'select public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'add',kind:'item',id:op.id,delta:-1}])])));
 const state=await call(A,'select public.hh_pull(0) r');assert.equal(Number(state.records[0].qty),1);
 console.log('PASS concurrent counter updates');

 // General photo gateway proposals run on actual PostgreSQL, never on a remote database.
 await pool.query("create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);create schema storage;create table storage.objects(bucket_id text,name text,unique(bucket_id,name));");
 for(const name of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql']){
  await pool.query(fs.readFileSync(path.resolve(__dirname,'../../supabase/proposals',name),'utf8'));
 }
 const SA=randomUUID(),SB=randomUUID(),SC=randomUUID(),C=randomUUID();
 for(const [sid,uid] of [[SA,A],[SB,B],[SC,C]])await pool.query('insert into auth.sessions values($1,$2,null)',[sid,uid]);
 const sig='public.hh_photo_service_v50(uuid,uuid,text,uuid,text,uuid,uuid,text,bigint,text,integer)';
 const wsig='public.hh_photo_cleanup_service_v50(uuid,text,text,boolean)';
 const priv=await pool.query("select has_function_privilege('authenticated',$1,'execute') a,has_function_privilege('anon',$1,'execute') n,has_function_privilege('service_role',$1,'execute') s,has_function_privilege('authenticated',$2,'execute') w",[sig,wsig]);
 assert.deepEqual(priv.rows[0],{a:false,n:false,s:true,w:false});
 const readRec=async()=> (await pool.query("select seq,fields->>'photoPath' photo from atokore_private.records where household_id=$1 and kind='item' and id=$2",[hh,op.id])).rows[0];
 const serviceSql='select public.hh_photo_service_v50($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r';
 const digest='a'.repeat(64);
 async function svc(uid,sid,action,params={}){
  const c=await pool.connect();
  try{await c.query('begin');await c.query('set local role service_role');
   const r=await c.query(serviceSql,[uid,sid,action,hh,op.id,params.file??null,params.operation??null,params.expected??null,params.seq??null,params.sha??null,params.bytes??null]);
   await c.query('commit');return r.rows[0].r;
  }catch(e){await c.query('rollback');throw e}finally{c.release()}
 }
 const rr=await readRec(),operation=randomUUID();
 // Two connections with the same expected version, one wins; a duplicate
 // operation by the winner must never consume a second quota slot.
 const contenders=[{uid:A,sid:SA,operation},{uid:B,sid:SB,operation:randomUUID()}];
 const outcomes=await Promise.all(contenders.map(async x=>{try{return {x,result:await svc(x.uid,x.sid,'reserve',{operation:x.operation,seq:rr.seq,sha:digest})}}catch(e){return {x,error:e}}}));
 assert.equal(outcomes.filter(x=>x.result).length,1);
 assert.equal(outcomes.filter(x=>x.error?.code==='55000').length,1);
 const win=outcomes.find(x=>x.result),file=win.result.file_id;
 const opts={operation:win.x.operation,seq:rr.seq,sha:digest};
 const replay=await svc(win.x.uid,win.x.sid,'reserve',opts);assert.equal(replay.file_id,file);
 await assert.rejects(svc(win.x.uid,win.x.sid,'reserve',{...opts,sha:'b'.repeat(64)}),e=>e.code==='23505');
 console.log('PASS actual PostgreSQL concurrent photo reservation / replay / digest conflict');
 // Two begin requests must not both grant an upload.
 const begins=await Promise.allSettled([1,2].map(()=>svc(win.x.uid,win.x.sid,'begin',{file,sha:digest})));
 assert.equal(begins.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(begins.filter(x=>x.status==='rejected'&&x.reason.code==='55000').length,1);
 const photo=begins.find(x=>x.status==='fulfilled').value.path;
 // This is a mock metadata insertion in the local CI database only.
 await pool.query("insert into storage.objects(bucket_id,name) values('atokore-private-photos-v2',$1)",[photo]);
 assert.equal((await svc(win.x.uid,win.x.sid,'finish',{file,sha:digest,bytes:631})).ok,true);
 const attached=await svc(win.x.uid,win.x.sid,'attach',{file,sha:digest});assert.equal(attached.path,photo);
 assert.equal((await svc(A,SA,'read',{file})).path,photo);
 assert.equal((await svc(B,SB,'read',{file})).path,photo);
 await assert.rejects(svc(C,SC,'read',{file}),e=>e.code==='42501');
 await assert.rejects(svc(A,SB,'read',{file}),e=>e.code==='42501');
 // Unauthorized direct RPC cannot supply arbitrary uid/session even if valid.
 const anon=await pool.connect();try{
  await anon.query('begin');await anon.query('set local role authenticated');
  await assert.rejects(anon.query(serviceSql,[A,SA,'read',hh,op.id,file,null,null,null,null,null]),e=>e.code==='42501');
 }finally{await anon.query('rollback');anon.release()}
 // Removal while another connection waits for the household lock.
 const owner=await pool.connect(),member=await pool.connect();
 try{
  const before=await readRec();
  await owner.query('begin');await owner.query('select id from atokore_private.households where id=$1 for update',[hh]);
  await owner.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
  await member.query('begin');await member.query('set local role service_role');
  const pending=member.query(serviceSql,[B,SB,'detach',hh,op.id,file,null,null,before.seq,null,null]).then(value=>({value}),error=>({error}));
  let blocked=false;
  for(let n=0;n<200;n++){const r=await pool.query('select cardinality(pg_blocking_pids($1))>0 blocked',[member.processID]);if(r.rows[0].blocked){blocked=true;break}await delay(20)}
  assert.equal(blocked,true,'photo detach must wait for household lock');
  await owner.query('select public.hh_remove_member($1)',[B]);await owner.query('commit');
  assert.equal((await pending).error?.code,'42501');await member.query('rollback');
 }finally{await owner.query('rollback');await member.query('rollback');owner.release();member.release()}
 await assert.rejects(svc(B,SB,'read',{file}),e=>e.code==='42501');
 assert.equal((await svc(A,SA,'read',{file})).path,photo);
 const before=await readRec();
 // An ordinary stock mutation invalidates the expected revision.
 await call(A,'select public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'add',kind:'item',id:op.id,delta:1}])]);
 await assert.rejects(svc(A,SA,'detach',{file,seq:before.seq}),e=>e.code==='40001');
 assert.equal((await readRec()).photo,photo);
 await pool.query('delete from auth.sessions where id=$1',[SA]);
 await assert.rejects(svc(A,SA,'read',{file}),e=>e.code==='42501');
 console.log('PASS actual PostgreSQL duplicate begin, attached-only read, cross-household denial, queued revocation, stale CAS and session removal');
}
main().then(()=>pool.end(),async e=>{console.error(e.message);await pool.end();process.exitCode=1});
