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
}
main().then(()=>pool.end(),async e=>{console.error(e.message);await pool.end();process.exitCode=1});
