// Real PostgreSQL, separate connections at the same time. CI's disposable database only.
// Family purchases of the same product made at the same moment on two phones are two different
// item fields (tp…), so the server keeps both; the same purchase sent again changes nothing; undo
// clears one field. The estimate computed from what the server returns is 120 + 60 + 60 = 240,
// and 180 after undoing one purchase. (PGlite cannot run two connections at once.)
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const L=require('../../atokore-live-v125/stock-levels-v51.js');
const url=process.env.ATOKORE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/atokore_ci'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use an isolated localhost atokore_ci database');
const pool=new Pool({connectionString:url,max:8});
const root=path.resolve(__dirname,'../..');

async function setup(){
 // Tolerates running after the other real-PostgreSQL scripts in the same disposable database.
 await pool.query(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 END$$;
 CREATE SCHEMA IF NOT EXISTS auth;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`);
 const has=(await pool.query("SELECT to_regnamespace('atokore_private') IS NOT NULL ok")).rows[0].ok;
 if(!has){
  const dir=path.join(root,'supabase/migrations');
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.includes('storage')).sort())await pool.query(fs.readFileSync(path.join(dir,f),'utf8'));
 }
}
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{
  await c.query('begin');await c.query('set local role authenticated');
  await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);
  const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r;
 }catch(e){await c.query('rollback');throw e}finally{c.release()}
}
const push=(uid,ops)=>rpc(uid,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify(ops)]);
const pull=async uid=>(await rpc(uid,'SELECT public.hh_pull(0) r')).records;
const DAY='2026-11-25';
function estimateFrom(records,id){
 const r=records.find(x=>x.kind==='item'&&x.id===id);
 const item={id:1,name:'合成 おむつ テープ M',unit:'袋',qty:Number(r.qty),...r.fields};
 for(const k of Object.keys(item))if(item[k]===null)delete item[k];
 return L.estimate(item,DAY);
}

async function main(){
 await setup();
 const A=randomUUID(),B=randomUUID();
 await rpc(A,"SELECT public.hh_create('QA purchase merge','QA-A') r");
 const inv=await rpc(A,'SELECT public.hh_invite_create() r');await rpc(B,'SELECT public.hh_join($1,$2) r',[inv.code,'QA-B']);
 const id='qa_merge_diaper';
 const t0=Date.parse(DAY+'T00:00:00Z');
 const track=L.startTrack({packs:2,perPack:60,perDay:6,pieceUnit:'枚',today:DAY,now:t0}).track;
 const created=await push(A,[{op_id:randomUUID(),type:'create',kind:'item',id,qty:2,fields:{name:'合成 おむつ テープ M',unit:'袋',track},ts:t0}]);
 assert.equal(created.results[0].status,'applied');
 assert.equal(estimateFrom(await pull(A),id).remaining,120);

 // Each phone's purchase, exactly as the app stores it (one field per purchase).
 const item={name:'合成 おむつ テープ M',unit:'袋',track};
 const pa=L.purchaseEntry(item,1,{today:DAY,now:t0+60000,key:'buy:phone-a'});
 const pb=L.purchaseEntry(item,1,{today:DAY,now:t0+60001,key:'buy:phone-b'});
 assert.notEqual(pa.field,pb.field);
 const opA={op_id:randomUUID(),type:'set',kind:'item',id,field:pa.field,value:pa.entry,ts:t0+60000};
 const opB={op_id:randomUUID(),type:'set',kind:'item',id,field:pb.field,value:pb.entry,ts:t0+60001};
 // Both reach the server at the same moment on separate connections, together with their restock.
 const [ra,rb]=await Promise.all([
  push(A,[{op_id:randomUUID(),type:'add',kind:'item',id,delta:1},opA]),
  push(B,[{op_id:randomUUID(),type:'add',kind:'item',id,delta:1},opB]),
 ]);
 assert.deepEqual(ra.results.map(x=>x.status),['applied','applied']);
 assert.deepEqual(rb.results.map(x=>x.status),['applied','applied']);
 let recA=await pull(A),recB=await pull(B);
 assert.equal(Number(recA.find(x=>x.id===id).qty),4);
 assert.equal(estimateFrom(recA,id).remaining,240,'120 + 60 + 60 for phone A');
 assert.equal(estimateFrom(recB,id).remaining,240,'and the same for phone B');

 // The same purchase sent again (same op, and the same field with a fresh op id): nothing changes.
 const again=await Promise.all([push(A,[opA]),push(A,[{...opA,op_id:randomUUID()}]),push(B,[opB])]);
 for(const r of again)assert.ok(['applied','duplicate','stale'].includes(r.results[0].status),r.results[0].status);
 assert.equal(estimateFrom(await pull(B),id).remaining,240,'a resend adds nothing');

 // Order reversed: an older write to B's field arriving late cannot replace B's purchase.
 const late=await push(B,[{...opB,op_id:randomUUID(),value:{...pb.entry,u:999},ts:t0+1}]);
 assert.equal(late.results[0].status,'stale');
 assert.equal(estimateFrom(await pull(A),id).remaining,240);

 // A undoes only its own purchase (field cleared + the server's purchase undo restock -1).
 const undo=await push(A,[{op_id:randomUUID(),type:'add',kind:'item',id,delta:-1},{op_id:randomUUID(),type:'set',kind:'item',id,field:pa.field,value:null,ts:t0+120000}]);
 assert.deepEqual(undo.results.map(x=>x.status),['applied','applied']);
 recA=await pull(A);recB=await pull(B);
 assert.equal(Number(recB.find(x=>x.id===id).qty),3);
 assert.equal(estimateFrom(recA,id).remaining,180,'undo one purchase: 180');
 assert.equal(estimateFrom(recB,id).remaining,180);
 console.log('PASS: simultaneous family purchases merge (240), resend adds nothing, late older write refused, undo one -> 180');
}
main().then(()=>pool.end(),async e=>{console.error(e);await pool.end();process.exit(1)});
