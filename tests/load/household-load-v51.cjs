// Isolated load measurement (F6). Real PostgreSQL on localhost ONLY, a disposable database named
// atokore_load. Never point this at Supabase or any shared database.
// Grows the synthetic data to 100 / 500 / 1000 / 3000 households (2 members, 30 items each) and at
// each size measures: quiet hh_pull (the request a visible, idle phone makes), a one-item hh_push,
// p50/p95 latency under concurrency, and database size. Prints one JSON line per size.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const url=process.env.ATOKORE_LOAD_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_load'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_load database');
const SIZES=(process.env.ATOKORE_LOAD_SIZES||'100,500,1000,3000').split(',').map(Number);
const CONCURRENCY=Number(process.env.ATOKORE_LOAD_CONCURRENCY||20),SAMPLES=Number(process.env.ATOKORE_LOAD_SAMPLES||400);
const pool=new Pool({connectionString:url,max:CONCURRENCY+4});
const root=path.resolve(__dirname,'../..');

async function setup(){
 await pool.query(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 END$$;
 CREATE SCHEMA IF NOT EXISTS auth;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`);
 if(!(await pool.query("SELECT to_regnamespace('atokore_private') IS NOT NULL ok")).rows[0].ok){
  const dir=path.join(root,'supabase/migrations');
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')).sort())await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
 }
}
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
  const r=await c.query(sql,params);await c.query('commit');return r.rows[0]?.r}
 catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}
}
const households=[];
async function addHousehold(i){
 const a=randomUUID(),b=randomUUID();
 await rpc(a,"select public.hh_create($1,'A') r",['load '+i]);
 const inv=await rpc(a,'select public.hh_invite_create() r');
 await rpc(b,"select public.hh_join($1,'B') r",[inv.code]);
 const ops=[...Array(30)].map((_,k)=>({op_id:randomUUID(),type:'create',kind:'item',id:'load_'+i+'_'+k,qty:3,fields:{name:'合成商品'+k,unit:'個',cat:'日用品'},ts:Date.now()}));
 await rpc(a,'select public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);
 const pulled=await rpc(b,'select public.hh_pull(0,500) r');
 households.push({a,b,cursor:Number(pulled.cursor)||0,item:'load_'+i+'_0'});
}
async function timed(n,fn){
 const times=[];let next=0;
 await Promise.all([...Array(CONCURRENCY)].map(async()=>{while(next<n){const i=next++;const t=process.hrtime.bigint();await fn(i);times.push(Number(process.hrtime.bigint()-t)/1e6)}}));
 times.sort((x,y)=>x-y);
 const q=p=>Math.round(times[Math.min(times.length-1,Math.floor(p*times.length))]*10)/10;
 return {n:times.length,p50:q(0.5),p95:q(0.95),max:q(1)};
}
async function main(){
 await setup();
 for(const size of SIZES){
  const started=Date.now();
  while(households.length<size){const batch=[];for(let k=0;k<CONCURRENCY&&households.length+batch.length<size;k++)batch.push(addHousehold(households.length+batch.length));await Promise.all(batch)}
  const growMs=Date.now()-started;
  const pick=()=>households[Math.floor(Math.random()*households.length)];
  // Quiet poll: the member already has everything (same cursor), so nothing new is returned.
  const pull=await timed(SAMPLES,async()=>{const h=pick();const r=await rpc(h.b,'select public.hh_pull($1,500) r',[h.cursor]);if((r.records||[]).length&&r.cursor)h.cursor=Number(r.cursor)});
  const push=await timed(Math.round(SAMPLES/4),async()=>{const h=pick();await rpc(h.a,'select public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'add',kind:'item',id:h.item,delta:1,ts:Date.now()}])])});
  const size_=(await pool.query("SELECT pg_database_size(current_database()) db,(SELECT pg_total_relation_size('atokore_private.records')) rec,(SELECT count(*) FROM atokore_private.records) rows")).rows[0];
  console.log(JSON.stringify({households:size,members:size*2,growMs,quietPullMs:pull,pushMs:push,dbMB:Math.round(Number(size_.db)/1048576*10)/10,recordsMB:Math.round(Number(size_.rec)/1048576*10)/10,records:Number(size_.rows),concurrency:CONCURRENCY}));
 }
}
main().then(()=>pool.end(),async e=>{console.error(e);await pool.end();process.exit(1)});
