// A1 (旧URL問題) isolated checks: legacy bucket closure drafts on the real migrations in PGlite, and the
// shipped client never talking to Storage URLs. The CDN behaviour itself cannot be tested here.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createDb,call,asRole}=require('./household/pg.cjs');
const SQL=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b1',C='00000000-0000-4000-8000-0000000000c1';
let n=1;const oid=()=>`20000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const LEGACY='atokore-product-photos';
async function service(db,sql){return db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query(sql)).rows})}
const objects=(db,uid)=>asRole(db,uid,"select name from storage.objects where bucket_id='"+LEGACY+"' order by name");
const insert=(db,uid,name)=>asRole(db,uid,"insert into storage.objects(bucket_id,name) values('"+LEGACY+"','"+name+"')");
async function fixture(){
 const db=await createDb();await db.exec(SQL('atokore-photo-gateway-v50.sql'));
 await call(db,A,'hh_create',{p_name:'家族',p_display_name:'親'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'家族'});
 const {household}=await call(db,A,'hh_my');
 await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id:'item-legacy-a1',fields:{name:'おむつ',unit:'袋'},qty:1,ts:Date.now()}]});
 const name=household.id+'/item-legacy-a1/'+oid()+'.jpg';
 await insert(db,A,name);
 // The record points at the legacy object, as written by pre-gateway clients.
 await db.query("update atokore_private.records set fields=fields||jsonb_build_object('photoPath',$1::text) where id='item-legacy-a1'",[name]);
 return {db,household,name};
}
test('stage 1: no client can add legacy objects; members keep seeing existing ones; leavers and outsiders cannot',async()=>{
 const {db,household,name}=await fixture();
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 await assert.rejects(insert(db,A,household.id+'/item-legacy-a1/'+oid()+'.jpg'),/row-level security/);
 await assert.rejects(insert(db,B,household.id+'/item-legacy-a1/'+oid()+'.jpg'),/row-level security/);
 assert.deepEqual((await objects(db,A)).map(r=>r.name),[name]);
 assert.deepEqual((await objects(db,B)).map(r=>r.name),[name]);
 assert.equal((await objects(db,C)).length,0);
 await assert.rejects(objects(db,null),/permission denied/);
 await call(db,A,'hh_remove_member',{p_user:B});
 assert.equal((await objects(db,B)).length,0,'origin re-checks membership on every request');
});
test('inventory is service-only and separates referenced objects from orphans',async()=>{
 const {db,household,name}=await fixture();
 const orphan=household.id+'/item-legacy-a1/'+oid()+'.jpg';await insert(db,A,orphan);
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 await assert.rejects(asRole(db,A,'select * from atokore_private.legacy_photo_inventory()'),/permission denied/);
 await assert.rejects(asRole(db,null,'select * from atokore_private.legacy_photo_inventory()'),/permission denied/);
 const rows=await service(db,'select household_id::text,record_id,path,referenced from atokore_private.legacy_photo_inventory()');
 const by=Object.fromEntries(rows.map(r=>[r.path,r]));
 assert.equal(rows.length,2);
 assert.equal(by[name].referenced,true);assert.equal(by[name].household_id,household.id);assert.equal(by[name].record_id,'item-legacy-a1');
 assert.equal(by[orphan].referenced,false);
 // A deleted record no longer counts as a reference (its object is an orphan to review).
 await db.query("update atokore_private.records set deleted=true where id='item-legacy-a1'");
 assert.equal((await service(db,'select count(*)::int c from atokore_private.legacy_photo_inventory() where referenced')).at(0).c,0);
});
// Stage 2 needs the ledger to tell a legacy reference from a managed one. The legacy reference is
// created before the v50 lifecycle trigger exists, as it was written by pre-gateway clients.
async function ledgerFixture(){
 const f=await fixture();
 await f.db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 await f.db.exec('ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()');
 for(const x of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql','atokore-photo-legacy-migrate-v51.sql'])await f.db.exec(SQL(x));
 await f.db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA legacy close')",[f.household.id]);
 await f.db.query("INSERT INTO storage.buckets(id,name,public) VALUES('atokore-private-photos-v2','atokore-private-photos-v2',false) ON CONFLICT(id) DO NOTHING");
 const svc=async(fn,args)=>(await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('select atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows})).at(0).r;
 return {...f,svc};
}
// begin -> copy (stand-in) -> commit -> read check (the worker's gateway-style read) -> legacy delete -> finish
const confirmDelete=(f,m)=>f.db.query("insert into atokore_private.photo_delete_intents_v51(bucket,path,gen,purpose,file_id,state,resolved_at) values($1,$2,null,'legacy',$3,'deleted',now())",[LEGACY,m.legacy_path,m.file_id]);
// What the separately approved real-environment proof would record (never created by the drafts).
// Work 8th: bound to this synthetic environment, the current write configuration and photo snapshot.
const recordGuarantee=async db=>{
 await db.query("insert into atokore_private.photo_environment_v51(project_ref,environment) values('synthetic-qa','synthetic') on conflict (singleton) do nothing");
 await db.query("insert into atokore_private.photo_storage_guarantees_v51(generation_proven,writes_fenced,gateway_http_proven,evidence,approved_by,project_ref,environment,buckets,write_config_version,snapshot_hash,issued_at,expires_at) values(true,true,true,'synthetic test: stands in for the real-project proof','QA','synthetic-qa','synthetic',array['atokore-product-photos','atokore-private-photos-v2','atokore-photo-backup-v51'],atokore_private.photo_write_config_version_v51(),atokore_private.photo_snapshot_v51(),now()-interval '1 minute',now()+interval '1 hour')");
};
async function moveAll(f,{finish=true,read=true}={}){
 const m=await f.svc('photo_legacy_begin_v51',[f.household.id,'item-legacy-a1']);
 await f.db.query("insert into storage.objects(bucket_id,name) values('atokore-private-photos-v2',$1)",[m.target_path]);
 await f.svc('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA]);
 if(read)await f.svc('photo_read_checked_v51',[m.file_id,SHA,900,(await f.svc('photo_read_target_v51',[m.file_id])).gen]);
 // The worker's confirmed delete (Work 7th: finish needs a confirmed outcome of a fenced delete).
 if(finish){await f.db.query("delete from storage.objects where bucket_id=$1",[LEGACY]);await confirmDelete(f,m);assert.equal(await f.svc('photo_legacy_finish_v51',[m.file_id,true]),true)}
 return m;
}
const policyNames=async db=>(await db.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1")).rows.map(r=>r.policyname);
const close=db=>db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql')).finally(()=>db.exec('rollback').catch(()=>{}));
const SHA='a'.repeat(64);
test('stage 2 refuses while any legacy object remains or stage 1 is missing, and changes nothing',async()=>{
 const {db,name,svc,household}=await ledgerFixture();
 await assert.rejects(close(db),/legacy_photos_remain/);
 // Move the reference properly, then remove the object: only stage 1 is now missing.
 await moveAll({db,svc,household});
 await assert.rejects(close(db),/legacy_stage1_missing/);
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_insert','atokore_photo_read']);
 assert.ok(name);
});
test('Work 4th: 0 legacy objects but 1 legacy reference is refused (the product would show a broken photo)',async()=>{
 const {db}=await ledgerFixture();
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 await db.query("delete from storage.objects where bucket_id=$1",[LEGACY]);       // object gone, reference left
 await assert.rejects(close(db),/legacy_references_remain/);
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read'],'nothing closed');
 // A deleted product still holding a legacy path counts too (a restore would bring it back).
 await db.query("update atokore_private.records set deleted=true where id='item-legacy-a1'");
 await assert.rejects(close(db),/legacy_references_remain/);
});
test('stage 2 also refuses an unfinished move (verified but not deleted), a missing hash, a missing object, and a photo nobody could read',async()=>{
 const f=await ledgerFixture();const {db,svc}=f;
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 // Switched but not read: the legacy object is already gone (Work's case) -> refused.
 const m=await moveAll(f,{read:false,finish:false});
 await db.query("delete from storage.objects where bucket_id=$1",[LEGACY]);
 await assert.rejects(close(db),/legacy_migration_unfinished/,'switched, never read');
 await svc('photo_read_checked_v51',[m.file_id,SHA,900,(await svc('photo_read_target_v51',[m.file_id])).gen]);
 await assert.rejects(close(db),/legacy_migration_unfinished/,'verified but not finished');
 assert.equal(await svc('photo_legacy_finish_v51',[m.file_id,true]),false,'no confirmed delete yet');
 await confirmDelete(f,m);
 assert.equal(await svc('photo_legacy_finish_v51',[m.file_id,true]),true);
 // Now consistent: break one condition at a time.
 await db.query('update atokore_private.photo_ledger_v50 set upload_sha256=null where file_id=$1',[m.file_id]);
 await assert.rejects(close(db),/photo_ledger_inconsistent/,'hash missing: the gateway would refuse it');
 await db.query('update atokore_private.photo_ledger_v50 set upload_sha256=$2 where file_id=$1',[m.file_id,SHA]);
 await db.query('delete from atokore_private.photo_read_checks_v51');
 await assert.rejects(close(db),/photo_unread_remain/,'never read');
 await db.query("insert into atokore_private.photo_read_checks_v51(file_id,sha256,bytes,checked_at,gen) values($1,$2,900,now()-interval '1 day',atokore_private.photo_object_gen_v51('atokore-private-photos-v2',$3))",[m.file_id,SHA,m.target_path]);
 await db.query("update storage.objects set created_at=now() where bucket_id='atokore-private-photos-v2' and name=$1",[m.target_path]);
 await assert.rejects(close(db),/photo_unread_remain/,'read before the object was (re)written');
 await db.query("update atokore_private.photo_read_checks_v51 set checked_at=now()+interval '1 second',sha256=$2 where file_id=$1",[m.file_id,'b'.repeat(64)]);
 await assert.rejects(close(db),/photo_unread_remain/,'read a different hash');
 await db.query("update atokore_private.photo_read_checks_v51 set sha256=$2 where file_id=$1",[m.file_id,SHA]);
 await db.query("delete from storage.objects where bucket_id='atokore-private-photos-v2' and name=$1",[m.target_path]);
 await assert.rejects(close(db),/photo_ledger_inconsistent/,'object missing');
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read']);
});
test('full order: copy, verify, switch, delete the legacy object, finish; then stage 2 closes every client path; the gateway check still works',async()=>{
 const f=await ledgerFixture();const {db,household,name,svc}=f;
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 const m=await moveAll(f);
 assert.equal(m.legacy_path,name);
 const next=m.target_path;
 // Work 7th: everything else is in order, but the real Storage guarantees are not proven -> refused.
 await assert.rejects(close(db),/storage_guarantee_unproven|environment_unknown/);
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read'],'nothing closed');
 await recordGuarantee(db);
 await db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql'));
 assert.deepEqual(await policyNames(db),[]);
 // Running it again (a second operator) changes nothing and does not fail.
 await db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql'));
 // Even if a legacy row reappeared (e.g. a restore), no client role can read or remove it.
 await db.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY,name]);
 assert.equal((await objects(db,A)).length,0);
 assert.equal((await asRole(db,A,"delete from storage.objects where bucket_id='"+LEGACY+"' returning name")).length,0);
 const access=(uid,p)=>asRole(db,uid,"select public.hh_photo_access('"+p+"','read') as ok").then(r=>r[0].ok);
 assert.equal(await access(A,next),true);
 assert.equal(await access(B,next),true);
 assert.equal(await access(A,name),false,'the old path is no longer the record photo');
 await call(db,A,'hh_remove_member',{p_user:B});
 assert.equal(await access(B,next),false,'removed member is refused by the gateway on the next request');
 assert.equal(await access(C,next),false);
});
test('shipped app files never build Storage object URLs (photos go only through the POST gateway)',()=>{
 const dir=path.join(__dirname,'../atokore-live-v125');
 const files=fs.readdirSync(dir).filter(f=>/\.(js|html)$/.test(f));
 assert.ok(files.length>20);
 for(const f of files){
  const src=fs.readFileSync(path.join(dir,f),'utf8');
  assert.equal(/storage\/v1\/object|\/object\/(authenticated|public|sign)\//.test(src),false,f);
  assert.equal(src.includes(LEGACY),false,f+' must not name the legacy bucket');
 }
 const sync=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 assert.match(sync,/functions\/v1\/atokore-photo-gateway/);
 assert.match(fs.readFileSync(path.join(dir,'household-config-v37.js'),'utf8'),/photoGatewayEnabled:\s*false/);
});
test('every draft applies together in the documented order, and the v51 RPCs still work on top of the photo drafts',async()=>{
 const db=await createDb();
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 for(const f of ['atokore-photo-gateway-v50.sql','atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql',
  'atokore-photo-legacy-migrate-v51.sql','atokore-buy-assignment-v51.sql','atokore-prep-share-v51.sql','atokore-photo-legacy-close-writes-v51.sql'])await db.exec(SQL(f));
 await call(db,A,'hh_create',{p_name:'家族',p_display_name:'親'});
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'家族'});
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) SELECT id,'QA all drafts' FROM atokore_private.households");
 await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'buy',id:'buy-all-drafts',fields:{name:'おしりふき'},qty:1,ts:Date.now()}]});
 const before=(await db.query("select seq from atokore_private.records where id='buy-all-drafts'")).rows[0].seq;
 const r=await call(db,A,'hh_buy_assign',{p_buy:'buy-all-drafts',p_assignee:B,p_expected_rev:0});
 assert.equal(r.status,'ready');
 const after=(await db.query("select seq from atokore_private.records where id='buy-all-drafts'")).rows[0].seq;
 assert.ok(Number(after)>Number(before),'assignment touches the buy cursor without tripping the photo triggers');
 assert.equal((await call(db,B,'hh_buy_respond',{p_buy:'buy-all-drafts',p_decision:'accept',p_expected_rev:1})).status,'ready');
 assert.equal((await call(db,A,'hh_prep_put',{p_doc:{v:1,children:[],week:{},events:{}},p_expected_rev:0})).status,'ready');
 // Ordinary sync still round-trips while every draft is present.
 const pulled=await call(db,B,'hh_pull',{p_since:0});
 assert.ok(pulled.records.some(x=>x.id==='buy-all-drafts'));
});

// ---------------------------------------------------------------- Work 8th (B)
// A proof that the real Storage behaves (generations, fenced writes, gateway HTTP) is only valid bound to:
// the project and environment, the bucket/write-policy configuration it was proven on, the exact photo
// snapshot, an issue and expiry time (at most 24 h), and not revoked. Outside a synthetic environment the
// close stays OFF unconditionally — a database row cannot switch on a real close.
async function readyToClose(){
 const f=await ledgerFixture();const {db}=f;
 await db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
 await moveAll(f);
 return f;
}
const oldStyle=db=>db.query("insert into atokore_private.photo_storage_guarantees_v51(generation_proven,writes_fenced,gateway_http_proven,evidence,approved_by) values(true,true,true,'an old record of another environment (unbound)','QA')");
test('B (Work 8th): an unbound record (old/other environment, three booleans) never closes the bucket',async()=>{
 const {db}=await readyToClose();
 await oldStyle(db);
 await assert.rejects(close(db),/storage_guarantee_unproven|operational_close_off|environment_unknown/);
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read'],'nothing closed');
});
const env=(db,environment,project='synthetic-qa')=>db.query("insert into atokore_private.photo_environment_v51(project_ref,environment) values($1,$2) on conflict (singleton) do update set project_ref=excluded.project_ref,environment=excluded.environment",[project,environment]);
const prove=(db,o={})=>db.query(`insert into atokore_private.photo_storage_guarantees_v51(generation_proven,writes_fenced,gateway_http_proven,evidence,approved_by,project_ref,environment,buckets,write_config_version,snapshot_hash,issued_at,expires_at,revoked_at)
  values(true,true,true,'synthetic proof for the isolated test','QA',$1,$2,$3,coalesce($4,atokore_private.photo_write_config_version_v51()),coalesce($5,atokore_private.photo_snapshot_v51()),now()+$6::interval,now()+$7::interval,$8)
  on conflict (singleton) do update set project_ref=excluded.project_ref,environment=excluded.environment,buckets=excluded.buckets,write_config_version=excluded.write_config_version,snapshot_hash=excluded.snapshot_hash,issued_at=excluded.issued_at,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at`,
  [o.project??'synthetic-qa',o.environment??'synthetic',o.buckets??['atokore-product-photos','atokore-private-photos-v2','atokore-photo-backup-v51'],o.config??null,o.snapshot??null,o.issued??'-1 minute',o.expires??'+1 hour',o.revoked??null]);
test('B (Work 8th): the proof is bound to project, environment, write configuration, snapshot, expiry and revocation',async()=>{
 const f=await readyToClose();const {db}=f;
 await env(db,'synthetic');
 const cases=[
  [{project:'synthetic-other'},'another project'],[{environment:'trial'},'another environment'],
  [{expires:'-1 second'},'expired'],[{revoked:new Date().toISOString()},'revoked'],[{issued:'-2 days',expires:'+1 hour'},'valid longer than 24 h'],
  [{config:'0'.repeat(32)},'proven on other write paths'],[{snapshot:'0'.repeat(32)},'proven on another snapshot'],
  [{buckets:['atokore-private-photos-v2']},'not all buckets']];
 for(const [o,why] of cases){await prove(db,o);await assert.rejects(close(db),/storage_guarantee_unproven/,why);assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read'],why)}
 // Proven, then the write configuration changes (a new policy) -> stale proof.
 await prove(db);
 await db.query("create policy qa_extra_read on storage.objects for select to authenticated using (false)");
 await assert.rejects(close(db),/storage_guarantee_unproven/,'write configuration changed after the proof');
 await db.query("drop policy qa_extra_read on storage.objects");
 // Proven, then an object is rewritten -> the snapshot no longer matches.
 await prove(db);
 const p=(await db.query("select atokore_private.photo_object_path_v50(l) p from atokore_private.photo_ledger_v50 l where state='attached' limit 1")).rows[0].p;
 await db.query("update storage.objects set updated_at=updated_at+interval '1 second' where bucket_id='atokore-private-photos-v2' and name=$1",[p]);
 await assert.rejects(close(db),/storage_guarantee_unproven|photo_unread_remain/,'rewritten after the proof');
});
test('B (Work 8th): outside a synthetic environment the close is OFF even with a perfect proof',async()=>{
 const {db}=await readyToClose();
 for(const e of ['trial','production']){
  await env(db,e,'proj-'+e);await prove(db,{project:'proj-'+e,environment:e});
  await assert.rejects(close(db),/operational_close_off/,e);
 }
 await db.query('delete from atokore_private.photo_environment_v51');
 await assert.rejects(close(db),/environment_unknown|operational_close_off/,'no environment record');
 assert.deepEqual(await policyNames(db),['atokore_photo_delete','atokore_photo_read']);
 // Synthetic and fully bound: closes (isolated test only).
 await env(db,'synthetic');await prove(db);
 await db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql'));
 assert.deepEqual(await policyNames(db),[]);
});
