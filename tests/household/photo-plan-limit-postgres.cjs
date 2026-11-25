// Real PostgreSQL, separate connections, actual lock waits. CI's disposable database only.
// Proves that two members uploading at the same time cannot both take a household's last shared
// cloud-photo slot (free plan: 5). PGlite covers the other plan-limit rules but cannot prove races.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:8});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve(__dirname,'../..');

async function setup(){
 // Tolerates running after revocation-postgres.cjs in the same disposable database.
 await pool.query(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 END$$;
 CREATE SCHEMA IF NOT EXISTS auth;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
 CREATE TABLE IF NOT EXISTS auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);`);
 const has=async sql=>(await pool.query(sql)).rows[0].ok;
 if(!await has("SELECT to_regnamespace('atokore_private') IS NOT NULL ok")){
  const dir=path.join(root,'supabase/migrations');
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')).sort())await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
 }
 if(!await has("SELECT to_regclass('atokore_private.photo_ledger_v50') IS NOT NULL ok"))
  await pool.query(fs.readFileSync(path.join(root,'supabase/proposals/atokore-photo-reservation-v50.sql'),'utf8'));
}
async function as(client,uid,sid){
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);
 await client.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,session_id:sid})]);
}
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await as(c,uid,null);const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback');throw e}finally{c.release()}
}
async function reserve(client,uid,sid,hh,record){
 return (await client.query('SELECT atokore_private.photo_reserve_v50($1,$2,$3,NULL) r',[hh,record,randomUUID()])).rows[0].r;
}
async function main(){
 await setup();
 const A=randomUUID(),B=randomUUID(),SA=randomUUID(),SB=randomUUID();
 await pool.query('INSERT INTO auth.sessions VALUES($1,$2,NULL),($3,$4,NULL)',[SA,A,SB,B]);
 const hh=(await rpc(A,"SELECT public.hh_create('QA photo plan','QA-A') r")).household.id;
 const inv=await rpc(A,'SELECT public.hh_invite_create() r');await rpc(B,'SELECT public.hh_join($1,$2) r',[inv.code,'QA-B']);
 const records=[...Array(6)].map((_,i)=>'qa_plan_item_'+i);
 for(const id of records){
  const res=await rpc(A,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'create',kind:'item',id,qty:1,fields:{name:'合成 '+id,unit:'個'},ts:Date.now()}])]);
  assert.equal(res.results[0].status,'applied');
 }
 // Four products already have a shared photo: one free slot left.
 for(const id of records.slice(0,4)){
  const c=await pool.connect();
  try{await c.query('begin');await as(c,A,SA);const r=await reserve(c,A,SA,hh,id);await c.query('commit');
   await pool.query("UPDATE atokore_private.photo_ledger_v50 SET state='attached',actual_bytes=40000 WHERE file_id=$1",[r.file_id]);}
  finally{c.release()}
 }
 const holder=await pool.connect(),x=await pool.connect(),y=await pool.connect();
 try{
  await holder.query('begin');await holder.query('SELECT 1 FROM atokore_private.photo_quota_lock_v50 WHERE singleton FOR UPDATE');
  await x.query('begin');await as(x,A,SA);await y.query('begin');await as(y,B,SB);
  const px=reserve(x,A,SA,hh,records[4]).then(value=>({value}),error=>({error}));
  const py=reserve(y,B,SB,hh,records[5]).then(value=>({value}),error=>({error}));
  for(const c of [x,y]){
   let blocked=false;
   for(let n=0;n<200&&!blocked;n++){blocked=(await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 b',[c.processID])).rows[0].b;if(!blocked)await delay(20)}
   assert.equal(blocked,true,'both uploads must really wait for the same lock');
  }
  await holder.query('commit');
  // Whichever got the lock first finishes while the other still waits for that transaction.
  const first=await Promise.race([px.then(r=>({...r,who:'x'})),py.then(r=>({...r,who:'y'}))]);
  if(first.error)throw first.error;
  const winner=first.who==='x'?x:y,loser=first.who==='x'?y:x;
  await winner.query('commit');
  const second=await (first.who==='x'?py:px);
  assert.ok(second.error,'the second simultaneous upload must be refused');
  assert.match(String(second.error.message),/photo_plan_limit/);
  await loser.query('rollback');
 }finally{holder.release();x.release();y.release()}
 const used=(await pool.query("SELECT count(DISTINCT record_id)::int n FROM atokore_private.photo_ledger_v50 WHERE household_id=$1 AND state IN ('reserved','uploading','uploaded','attached')",[hh])).rows[0].n;
 assert.equal(used,5,'exactly the free limit, never more');
 console.log('PASS: simultaneous uploads cannot pass the household photo limit (5 of 5 used)');
}
main().then(()=>pool.end(),async e=>{console.error(e);await pool.end();process.exit(1)});
