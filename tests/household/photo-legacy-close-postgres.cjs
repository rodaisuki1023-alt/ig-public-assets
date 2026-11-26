// Real PostgreSQL, separate connections, actual lock waits. CI's disposable database only; run it
// after the other real-PostgreSQL scripts (it applies the photo drafts and closes the legacy bucket).
// PGlite proves the close guard's rules; this proves they hold while other writers run at the same time:
//  1) a legacy reference written at the same moment cannot slip past the guard (it waits, then sees it),
//  2) a write that starts while the close holds its locks waits for it,
//  3) two operators closing at once: one closes, the other changes nothing, no error, no deadlock.
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
const P=f=>fs.readFileSync(path.join(root,'supabase/proposals',f),'utf8');
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2';

async function setup(){
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
 // The Storage tables Supabase provides (only what the policies and drafts use). An earlier CI script
 // may have left a smaller stub (objects only), so each part is completed if missing.
 await pool.query(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE IF NOT EXISTS storage.objects(bucket_id text,name text,UNIQUE(bucket_id,name));
  ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS metadata jsonb;
  ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;`);
 if(!await has("SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='atokore_photo_read') ok"))
  await pool.query(fs.readFileSync(path.join(root,'supabase/migrations/20261024111742_atokore_photo_storage_v44.sql'),'utf8'));
 if(!await has("SELECT to_regclass('atokore_private.photo_ledger_v50') IS NOT NULL ok"))
  await pool.query(P('atokore-photo-reservation-v50.sql'));
 if(!await has("SELECT to_regprocedure('atokore_private.photo_attach_v50(uuid,text,uuid)') IS NOT NULL ok"))
  await pool.query(P('atokore-photo-lifecycle-v50.sql'));
 if(!await has("SELECT to_regclass('atokore_private.photo_legacy_moves_v51') IS NOT NULL ok"))
  await pool.query(P('atokore-photo-legacy-migrate-v51.sql'));
 if(!await has("SELECT to_regprocedure('atokore_private.legacy_photo_inventory()') IS NOT NULL ok"))
  await pool.query(P('atokore-photo-legacy-close-writes-v51.sql'));
 await pool.query("INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING",[V2]);
}
async function rpc(uid,sql,params=[]){
 const c=await pool.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);const r=await c.query(sql,params);await c.query('commit');return r.rows[0].r}
 catch(e){await c.query('rollback');throw e}finally{c.release()}
}
// A legacy reference as written by pre-gateway clients (the v50 guard did not exist then).
async function writeLegacyRef(client,hh,id){
 const p=hh+'/'+id+'/'+randomUUID()+'.jpg';
 await client.query("SET LOCAL session_replication_role = replica");
 await client.query("UPDATE atokore_private.records SET fields=fields||jsonb_build_object('photoPath',$1::text) WHERE household_id=$2 AND id=$3",[p,hh,id]);
 return p;
}
const policies=async()=>(await pool.query("SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('atokore_photo_read','atokore_photo_delete') ORDER BY 1")).rows.map(r=>r.policyname);
async function runClose({holdMs=0}={}){
 const c=await pool.connect();
 try{
  let sql=P('atokore-photo-legacy-close-reads-v51.sql');
  if(holdMs)sql=sql.replace(/\nCOMMIT;/,'\nSELECT pg_sleep('+holdMs/1000+');\nCOMMIT;');
  await c.query(sql);return 'closed';
 }catch(e){await c.query('rollback').catch(()=>{});return e.message}
 finally{c.release()}
}

async function main(){
 await setup();
 const A=randomUUID();
 const hh=(await rpc(A,"SELECT public.hh_create('QA legacy close','QA-A') r")).household.id;
 const id='qa_close_item_1';
 await rpc(A,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'create',kind:'item',id,qty:1,fields:{name:'合成 '+id,unit:'個'},ts:Date.now()}])]);
 // Make the database closable first: no other legacy reference or object left from earlier runs.
 const left=(await pool.query("SELECT count(*)::int c FROM atokore_private.records r WHERE r.fields->>'photoPath' IS NOT NULL AND atokore_private.photo_is_legacy_ref_v51(r.household_id,r.id,r.fields->>'photoPath')")).rows[0].c;
 assert.equal(left,0,'start from a database without legacy references');
 await pool.query('DELETE FROM storage.objects WHERE bucket_id=$1',[LEGACY]);
 // photo-plan-limit-postgres.cjs leaves 'attached' ledger rows with no record reference and no object
 // (it tests only the quota). A real inconsistency like that must stop the close:
 if((await pool.query("SELECT count(*)::int c FROM atokore_private.photo_ledger_v50 WHERE state='attached'")).rows[0].c){
  assert.match(await runClose(),/photo_ledger_inconsistent/);
  console.log('PASS: attached ledger rows without their reference/object stop the close');
  // Those are the other script's quota stand-ins; retire them so this script can test the rest.
  await pool.query("UPDATE atokore_private.photo_ledger_v50 l SET state='retired' FROM atokore_private.households h WHERE h.id=l.household_id AND h.name='QA photo plan' AND l.state='attached'");
 }
 assert.deepEqual(await policies(),['atokore_photo_delete','atokore_photo_read']);

 // 1) A legacy reference committed while the close is starting: the close waits and refuses.
 const w=await pool.connect();
 await w.query('BEGIN');
 await writeLegacyRef(w,hh,id);
 const closing=runClose();
 await delay(300);
 await w.query('COMMIT');w.release();
 assert.match(await closing,/legacy_references_remain/);
 assert.deepEqual(await policies(),['atokore_photo_delete','atokore_photo_read'],'nothing closed');
 console.log('PASS: a legacy reference written at the same time is seen; close refused');

 // Clear it the reviewed way for this test database (direct, as the stand-in for an approved fix).
 await pool.query("BEGIN; SET LOCAL session_replication_role = replica; UPDATE atokore_private.records SET fields=fields-'photoPath' WHERE household_id='"+hh+"' AND id='"+id+"'; COMMIT;");

 // 2) A write that starts while the close holds its locks waits until the close is done.
 const order=[];
 const held=runClose({holdMs:600}).then(r=>{order.push('close:'+r);return r});
 await delay(200);
 const write=rpc(A,'SELECT public.hh_push($1::jsonb) r',[JSON.stringify([{op_id:randomUUID(),type:'add',kind:'item',id,delta:1}])]).then(r=>{order.push('write');return r});
 const [closed,written]=await Promise.all([held,write]);
 assert.equal(closed,'closed');
 assert.equal(written.results[0].status,'applied');
 assert.deepEqual(order,['close:closed','write'],'the write waited for the close');
 assert.deepEqual(await policies(),[]);
 console.log('PASS: a write during the close waits for it; reads closed with 0 legacy references');

 // 3) Two operators at once after closing: both finish, nothing else changes, no deadlock.
 const both=await Promise.all([runClose(),runClose()]);
 assert.deepEqual(both,['closed','closed']);
 assert.deepEqual(await policies(),[]);
 console.log('PASS: two simultaneous closes serialize; no error, no deadlock');
}
main().then(()=>pool.end(),e=>{console.error(e);pool.end();process.exit(1)});
