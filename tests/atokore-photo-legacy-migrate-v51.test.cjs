// v51 photo A drafts (isolated PGlite; Storage is an in-memory fake). Legacy reference -> managed ledger
// move that never deletes a legacy photo before the moved one is read through the general gateway's
// rules with the same bytes; resume from every step; shared paths; orphan collection; trial-only scope;
// backup and restore rehearsal.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),jpeg=require('jpeg-js');
const {createDb,call}=require('./household/pg.cjs');
const SQL=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000002a1',B='00000000-0000-4000-8000-0000000002b1',X='00000000-0000-4000-8000-0000000002c1';
const SA='00000000-0000-4000-9000-0000000002a1',SB='00000000-0000-4000-9000-0000000002b1';
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2',BACKUP='atokore-photo-backup-v51';
let n=1;const oid=()=>`30000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const mods=Promise.all([import('../supabase/proposals/photo-orphan-worker-v51.mjs'),import('../supabase/proposals/photo-general-v50.mjs')]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const photo=seed=>{const w=8,h=8,d=Buffer.alloc(w*h*4);for(let i=0;i<w*h;i++){d[i*4]=(seed*37+i)%256;d[i*4+1]=seed*11%256;d[i*4+2]=i*3%256;d[i*4+3]=255}return new Uint8Array(jpeg.encode({data:d,width:w,height:h},80).data)};
async function fixture(opts={}){const {trial=true}=opts;
 const db=await createDb();
 await db.exec(SQL('atokore-photo-gateway-v50.sql'));
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL),($3,$4,NULL)',[SA,A,SB,B]);
 const h=(await call(db,A,'hh_create',{p_name:'QA move',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 const bytes=new Map(),legacy={};
 for(const [i,id] of ['item_move_0001','item_move_0002','item_move_0003'].entries()){
  await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id,fields:{name:'合成 '+id,unit:'個'},qty:1,ts:Date.now()}]});
  legacy[id]=h+'/'+id+'/'+randomUUID()+'.jpg';
  bytes.set(LEGACY+':'+legacy[id],photo(i+1));
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY,legacy[id]]);
  // Written by pre-gateway clients, before the v50 guard existed.
  await db.query("update atokore_private.records set fields=fields||jsonb_build_object('photoPath',$1::text) where id=$2",[legacy[id],id]);
 }
 // Stage 1 (legacy writes closed) is required before any legacy object may be deleted.
 for(const f of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql','atokore-photo-legacy-migrate-v51.sql',...(opts.writesOpen?[]:['atokore-photo-legacy-close-writes-v51.sql'])])await db.exec(SQL(f));
 for(const b of [V2,BACKUP])await db.query("INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING",[b]);
 if(trial)await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA move')",[h]);
 const sql=async(fn,args)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('select atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows})).at(0).r;
 const objects=async bucket=>(await db.query('select name from storage.objects where bucket_id=$1 order by name',[bucket])).rows.map(r=>r.name);
 const rec=async id=>(await db.query("select fields->>'photoPath' p,seq from atokore_private.records where id=$1",[id])).rows[0];
 const ledger=async file=>(await db.query('select state,upload_sha256,actual_bytes from atokore_private.photo_ledger_v50 where file_id=$1',[file])).rows[0];
 const move=async file=>(await db.query('select state,attempts from atokore_private.photo_legacy_moves_v51 where file_id=$1',[file])).rows[0];
 // Fake Storage API. failRemove / corrupt can be switched on to simulate failures.
 const storage={failRemove:false,failCopy:false,corrupt:null,removed:[],
  async download(bucket,p){const b=bytes.get(bucket+':'+p);if(!b)throw Error('absent');return this.corrupt===p?photo(99):b},
  async remove(bucket,p){if(this.failRemove)return false;this.removed.push(bucket+':'+p);bytes.delete(bucket+':'+p);await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,p]);return true},
  // Synthetic adapter that DECLARES and implements the guarantees the worker needs (Work 7th): a delete
  // conditioned on the generation, atomic in one statement, and an authoritative look-up. beforeRemove runs
  // after the last SQL decision and right before the external delete (the race point); removeError and
  // statError simulate lost / unclear answers.
  capabilities:{conditionalRemove:opts.capable!==false,authoritativeStat:opts.capable!==false},beforeRemove:null,removeError:null,statError:null,removeAfterError:false,
  async removeIfGeneration(bucket,p,gen){
   if(this.beforeRemove){const f=this.beforeRemove;this.beforeRemove=null;await f(bucket,p)}
   if(this.removeError&&!this.removeAfterError)throw Error(this.removeError);
   const r=(await db.query('delete from storage.objects where bucket_id=$1 and name=$2 and atokore_private.photo_object_gen_v51(bucket_id,name) is not distinct from $3 returning name',[bucket,p,gen])).rows;
   let out;
   if(r.length){this.removed.push(bucket+':'+p);bytes.delete(bucket+':'+p);out={status:'deleted'}}
   else out=(await db.query('select 1 from storage.objects where bucket_id=$1 and name=$2',[bucket,p])).rows.length?{status:'mismatch'}:{status:'absent'};
   if(this.removeError&&this.removeAfterError)throw Error(this.removeError);   // done, answer lost
   return out},
  async stat(bucket,p){
   if(this.statError)throw Error(this.statError);
   if(!(await db.query('select 1 from storage.buckets where id=$1',[bucket])).rows.length)throw Error('unknown bucket');
   const r=(await db.query('select atokore_private.photo_object_gen_v51($1,$2) g',[bucket,p])).rows[0].g;
   return r==null?{exists:false,gen:null}:{exists:true,gen:r}},
  async copy(fb,from,tb,to){if(this.failCopy&&tb===V2)throw Error('network');const b=bytes.get(fb+':'+from);if(!b)throw Error('absent');
   if(!bytes.has(tb+':'+to)){bytes.set(tb+':'+to,b);await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[tb,to])}
   const back=bytes.get(tb+':'+to);return {bytes:back.length,sourceSha:sha(b),targetSha:sha(back),legacySha:sha(b),copySha:sha(back)}}};
 // The real general gateway handler, with members' verified identities and the real service SQL.
 const [{createGeneralPhotoHandler,makeJpegNormalizer}]=[(await mods)[1]];
 const identity={A:{uid:A,session:SA},B:{uid:B,session:SB}};
 const service=(user,action,f)=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');const args={p_uid:user.uid,p_session:user.session,p_action:action,...f};
  return (await tx.query('SELECT public.hh_photo_service_v50('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r});
 const gateway=createGeneralPhotoHandler({verify:async t=>identity[t]||null,db:service,storage:{download:p=>storage.download(V2,p),upload:async()=>{throw Error('no upload here')}},normalize:makeJpegNormalizer(jpeg)});
 const gatewayRead=(who,p)=>gateway({operation:'read',path:p},who);
 return {db,h,legacy,bytes,sql,objects,rec,ledger,move,storage,gatewayRead};
}
test('no client can call the migration, read-check or clean-up functions',async()=>{
 const {db}=await fixture();
 try{
  for(const role of ['anon','authenticated'])for(const fn of ['photo_legacy_commit_v51(uuid,integer,text,text)','photo_read_checked_v51(uuid,text,integer,text)','photo_legacy_delete_ok_v51(uuid)','photo_legacy_restore_v51(uuid)','photo_orphans_v51(integer,interval)'])
   assert.equal((await db.query("select has_function_privilege($1,'atokore_private."+fn+"','EXECUTE') ok",[role])).rows[0].ok,false,role+' '+fn);
 }finally{await db.close()}
});
test('move: upload_sha256 is set with the switch; the general gateway serves the same bytes; only then is the legacy photo removed',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  const id='item_move_0001',original=f.bytes.get(LEGACY+':'+f.legacy[id]);
  const r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  assert.equal(r.status,'done');
  const now=await f.rec(id);
  const l=await f.ledger(r.file_id);
  assert.deepEqual([l.state,l.upload_sha256,l.actual_bytes],['attached',sha(original),original.length],'Work: upload_sha256 was NULL');
  for(const who of ['A','B']){                         // both members, through the real gateway
   const g=await f.gatewayRead(who,now.p);
   assert.equal(g.status,200,who);assert.equal(sha(g.bytes),sha(original));
  }
  assert.deepEqual(f.storage.removed,[LEGACY+':'+f.legacy[id]],'the legacy photo was removed once, after the read');
  assert.equal((await f.move(r.file_id)).state,'done');
 }finally{await f.db.close()}
});
test('regression: when the moved photo cannot be read (hash NULL, wrong bytes, missing), the legacy photo is never deleted',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  // a) Work's case: the ledger hash is missing -> the gateway refuses -> stays switched, legacy kept.
  const id='item_move_0001';
  const m=await f.sql('photo_legacy_begin_v51',[f.h,id]);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.legacySha,c.copySha]);
  await f.db.query('update atokore_private.photo_ledger_v50 set upload_sha256=null where file_id=$1',[m.file_id]);
  assert.equal((await f.gatewayRead('A',m.target_path)).status,403);
  let r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  assert.deepEqual([r.status,r.held],['switched','not_readable']);
  assert.deepEqual((await f.sql('photo_legacy_delete_ok_v51',[m.file_id])),{ok:false,why:'not_verified'});
  assert.equal(await f.sql('photo_legacy_finish_v51',[m.file_id,true]),false);
  assert.deepEqual(f.storage.removed,[]);assert.ok((await f.objects(LEGACY)).includes(f.legacy[id]));
  // b) The stored copy is not the same bytes: the gateway's hash check fails -> legacy kept.
  await f.db.query('update atokore_private.photo_ledger_v50 set upload_sha256=$2 where file_id=$1',[m.file_id,c.copySha]);
  f.storage.corrupt=m.target_path;
  r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  assert.deepEqual([r.status,r.held],['switched','invalid_photo']);
  // c) The copy disappeared: the download fails -> legacy kept.
  f.storage.corrupt=null;f.bytes.delete(V2+':'+m.target_path);
  r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  assert.deepEqual([r.status,r.held],['switched','read_failed']);
  assert.deepEqual(f.storage.removed,[],'nothing deleted in any of the three');
  assert.equal((await f.move(m.file_id)).state,'switched');
  // A read check with a hash other than the legacy one is refused by the database itself.
  f.bytes.set(V2+':'+m.target_path,f.bytes.get(LEGACY+':'+m.legacy_path));
  const gen=(await f.sql('photo_read_target_v51',[m.file_id])).gen;
  await assert.rejects(f.sql('photo_read_checked_v51',[m.file_id,'f'.repeat(64),c.bytes,gen]),/photo_read_mismatch/);
  // Repaired: the next run reads, verifies and completes.
  r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  assert.equal(r.status,'done');
 }finally{await f.db.close()}
});
test('recovery from every step: copy failure, lost commit answer, crash after the switch, failed legacy delete, lost finish',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  const id='item_move_0002',run=()=>moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:id});
  f.storage.failCopy=true;
  let r=await run();assert.deepEqual([r.status,r.held],['copying','copy_failed']);
  f.storage.failCopy=false;
  // Commit answered but the answer was lost: the next begin resumes at 'switched' (not photo_not_legacy).
  const m=await f.sql('photo_legacy_begin_v51',[f.h,id]);assert.equal(m.state,'copying');assert.equal(m.reused,true);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.legacySha,c.copySha]);
  assert.deepEqual(await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.legacySha,c.copySha]),{status:'switched',path:m.target_path,reused:true});
  const resumed=await f.sql('photo_legacy_begin_v51',[f.h,id]);
  assert.deepEqual([resumed.state,resumed.file_id,resumed.reused],['switched',m.file_id,true],'Work: resume used to fail with photo_not_legacy');
  // The legacy delete answers 503 and the look-up 502: nothing is assumed, it stays verified (fenced), kept.
  f.storage.removeError='503';f.storage.statError='502';
  r=await run();assert.deepEqual([r.status,r.held],['verified','delete_unconfirmed']);
  assert.ok((await f.objects(LEGACY)).includes(f.legacy[id]));
  f.storage.removeError=null;f.storage.statError=null;
  r=await run();assert.equal(r.status,'done');
  // finish answered but lost: finishing again is still true and changes nothing.
  assert.equal(await f.sql('photo_legacy_finish_v51',[m.file_id,true]),true);
  assert.equal((await f.move(m.file_id)).state,'done');
  assert.equal((await f.gatewayRead('B',(await f.rec(id)).p)).status,200);
 }finally{await f.db.close()}
});
test('a legacy photo still used by another product is kept until that product is moved too',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  // item_move_0003 points at the SAME legacy object as item_move_0001 (an old copy of the product).
  await f.db.query("SET session_replication_role = replica");
  await f.db.query("update atokore_private.records set fields=fields||jsonb_build_object('photoPath',$1::text) where id='item_move_0003'",[f.legacy.item_move_0001]);
  await f.db.query("SET session_replication_role = DEFAULT");
  const r1=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'});
  assert.deepEqual([r1.status,r1.held],['verified','still_referenced']);
  assert.ok((await f.objects(LEGACY)).includes(f.legacy.item_move_0001));
  const r3=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0003'});
  assert.equal(r3.status,'done',JSON.stringify(r3));
  assert.equal((await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'})).status,'done');
  for(const id of ['item_move_0001','item_move_0003'])assert.equal((await f.gatewayRead('A',(await f.rec(id)).p)).status,200,id);
 }finally{await f.db.close()}
});
test('backup and restore rehearsal: the product points at its legacy photo again and the copy is collected',async()=>{
 const f=await fixture();
 try{
  const {runOrphanPass,restoreLegacyPhoto}=(await mods)[0];
  const id='item_move_0002',before=await f.rec(id);
  const m=await f.sql('photo_legacy_begin_v51',[f.h,id]);
  const backup=(await f.db.query('select photo_path,record_seq from atokore_private.photo_legacy_backup_v51 where file_id=$1',[m.file_id])).rows[0];
  assert.deepEqual([backup.photo_path,String(backup.record_seq)],[before.p,String(before.seq)]);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.legacySha,c.copySha]);
  // Work 7th: back onto the legacy photo only after reading it (same bytes as moved).
  assert.equal((await f.sql('photo_legacy_restore_v51',[m.file_id])).status,'verify_legacy','SQL alone does not switch');
  f.storage.corrupt=before.p;
  assert.deepEqual((await restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:m.file_id})).held,'legacy_mismatch');
  assert.equal((await f.rec(id)).p,m.target_path,'a legacy object with other bytes is not restored');
  f.storage.corrupt=null;
  const r=await restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:m.file_id});
  assert.equal(r.status,'restored');
  assert.equal((await f.rec(id)).p,before.p);
  assert.equal((await f.ledger(m.file_id)).state,'retired');
  assert.equal((await f.gatewayRead('A',m.target_path)).status,403,'the copy is no longer served');
  assert.ok((await f.objects(LEGACY)).includes(before.p),'the legacy photo was never touched');
  assert.deepEqual((await runOrphanPass({sql:f.sql,storage:f.storage})).purged,[m.file_id]);
  // After a restore the product can be moved again from the start.
  const again=await f.sql('photo_legacy_begin_v51',[f.h,id]);assert.equal(again.reused,false);
 }finally{await f.db.close()}
});
test('if the product changes while copying, the person\'s change wins and the copy is collected as an orphan',async()=>{
 const f=await fixture();
 try{
  const {runOrphanPass}=(await mods)[0];
  const id='item_move_0002';
  const m=await f.sql('photo_legacy_begin_v51',[f.h,id]);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  assert.equal((await call(f.db,A,'hh_push',{p_ops:[{op_id:oid(),type:'delete',kind:'item',id,ts:Date.now()+2000}]})).results[0].status,'applied');
  assert.deepEqual(await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.legacySha,c.copySha]),{status:'abandoned',reused:false});
  assert.equal((await f.ledger(m.file_id)).state,'retired');
  f.storage.removeError='502';f.storage.statError='timeout';
  let r=await runOrphanPass({sql:f.sql,storage:f.storage});
  assert.deepEqual(r.failed.map(x=>x.why),['delete_unconfirmed'],'unclear: the row stays purging (fenced) for the next pass');
  f.storage.removeError=null;f.storage.statError=null;
  r=await runOrphanPass({sql:f.sql,storage:f.storage});
  assert.deepEqual(r.purged,[m.file_id]);
  assert.ok((await f.objects(LEGACY)).includes(f.legacy[id]),'legacy objects are never touched by the clean-up');
  r=await runOrphanPass({sql:f.sql,storage:f.storage});
  assert.deepEqual([r.purged,r.retired,r.removedOrphans,r.failed],[[],[],[],[]],'a second pass changes nothing');
 }finally{await f.db.close()}
});
test('orphan pass and uploads: an object that gets a ledger row between listing and deleting is kept',async()=>{
 const f=await fixture();
 try{
  const {runOrphanPass}=(await mods)[0];
  const file=randomUUID(),p=f.h+'/item_move_0003/'+file+'.jpg';
  await f.db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days')",[V2,p]);
  // An upload is reserved for exactly that object after the list was made.
  const racing=async(fn,args)=>{if(fn==='photo_orphan_object_ok_v51')await f.db.query("insert into atokore_private.photo_ledger_v50(file_id,household_id,record_id,actor,operation_id,expected_seq,state,expires_at) values($1,$2,'item_move_0003',$3,gen_random_uuid(),1,'uploading',now()+interval '5 minutes')",[file,f.h,A]);return f.sql(fn,args)};
  const r=await runOrphanPass({sql:racing,storage:f.storage});
  assert.deepEqual(r.kept.map(x=>x.why),['now_ledgered_referenced_or_changed']);
  assert.ok((await f.objects(V2)).includes(p));
 }finally{await f.db.close()}
});
test('scope: only synthetic trial households, only the two buckets and scoped paths',async()=>{
 const f=await fixture({trial:false});
 try{
  const {runOrphanPass,moveLegacyPhoto}=(await mods)[0];
  await assert.rejects(f.sql('photo_legacy_begin_v51',[f.h,'item_move_0001']),/photo_not_trial_household/);
  const stray=f.h+'/item_move_0001/'+randomUUID()+'.jpg';
  await f.db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days')",[V2,stray]);
  assert.deepEqual(await runOrphanPass({sql:f.sql,storage:f.storage}),{retired:[],purged:[],removedOrphans:[],kept:[],failed:[],reported:[]},'nothing of a non-trial household is listed');
  assert.equal(await f.sql('photo_orphan_object_ok_v51',[stray,'any']),false);
  // The worker refuses a target outside the scoped path form even if the database returned one.
  const bad=async fn=>fn==='photo_legacy_begin_v51'?{file_id:randomUUID(),state:'copying',legacy_path:'../../etc/passwd',target_path:'x'}:null;
  await assert.rejects(moveLegacyPhoto({sql:bad,storage:f.storage,household:f.h,record:'item_move_0001'}),/out of scope/);
  assert.deepEqual(f.storage.removed,[]);
 }finally{await f.db.close()}
});
test('read checks cover every attached photo of a trial household; a mismatch is not recorded',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto,runReadChecks}=(await mods)[0];
  const r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'});
  assert.deepEqual(await f.sql('photo_read_check_due_v51',[50]),[],'the move already recorded its read');
  await f.db.query('delete from atokore_private.photo_read_checks_v51');
  f.storage.corrupt=(await f.rec('item_move_0001')).p;
  let c=await runReadChecks({sql:f.sql,storage:f.storage});
  assert.deepEqual(c.failed.map(x=>x.why),['invalid_photo']);
  f.storage.corrupt=null;
  c=await runReadChecks({sql:f.sql,storage:f.storage});
  assert.deepEqual(c.ok,[r.file_id]);
 }finally{await f.db.close()}
});

// Work 6th: fault injection around the last checks before a legacy photo or an orphan is deleted.
const genOf=(f,bucket,p)=>f.db.query('select atokore_private.photo_object_gen_v51($1,$2) g',[bucket,p]).then(r=>r.rows[0].g);
const bump=(f,bucket,p)=>f.db.query("update storage.objects set updated_at=updated_at+interval '1 second',metadata=coalesce(metadata,'{}')||jsonb_build_object('eTag',md5(random()::text)) where bucket_id=$1 and name=$2",[bucket,p]);
test('fault: the copy is rewritten after its read (same path) -> the delete is refused until a new read',async()=>{
 const f=await fixture();
 try{
  const {checkRead}=(await mods)[0];
  const id='item_move_0001';
  const m=await f.sql('photo_legacy_begin_v51',[f.h,id]);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.sourceSha,c.targetSha]);
  assert.equal((await checkRead({sql:f.sql,storage:f.storage},m.file_id)).ok,true);
  const b=await f.storage.copy(LEGACY,m.legacy_path,BACKUP,m.target_path);
  await f.sql('photo_legacy_backup_recorded_v51',[m.file_id,b.targetSha,b.bytes]);
  assert.equal((await f.sql('photo_legacy_delete_ok_v51',[m.file_id])).ok,true);
  await bump(f,V2,m.target_path);                                        // written again after the read
  assert.deepEqual(await f.sql('photo_legacy_delete_ok_v51',[m.file_id]),{ok:false,why:'read_not_fresh'});
  // An old read older than 10 minutes is not fresh either.
  assert.equal((await checkRead({sql:f.sql,storage:f.storage},m.file_id)).ok,true);
  await f.db.query("update atokore_private.photo_read_checks_v51 set checked_at=now()-interval '11 minutes'");
  assert.deepEqual(await f.sql('photo_legacy_delete_ok_v51',[m.file_id]),{ok:false,why:'read_not_fresh'});
  assert.deepEqual(f.storage.removed,[]);
 }finally{await f.db.close()}
});
test('fault: a read check whose object changed during the read is refused; a failed read takes the move back to switched',async()=>{
 const f=await fixture();
 try{
  const {checkRead}=(await mods)[0];
  const m=await f.sql('photo_legacy_begin_v51',[f.h,'item_move_0001']);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.sourceSha,c.targetSha]);
  const t=await f.sql('photo_read_target_v51',[m.file_id]);
  await bump(f,V2,m.target_path);                                        // a write while the read ran
  await assert.rejects(f.sql('photo_read_checked_v51',[m.file_id,t.sha,t.bytes,t.gen]),/photo_read_mismatch/);
  assert.equal((await checkRead({sql:f.sql,storage:f.storage},m.file_id)).ok,true);
  assert.equal((await f.move(m.file_id)).state,'verified');
  f.storage.corrupt=m.target_path;                                       // now it reads back other bytes (502)
  assert.equal((await checkRead({sql:f.sql,storage:f.storage},m.file_id)).ok,false);
  assert.equal((await f.move(m.file_id)).state,'switched','the verification no longer counts');
  assert.equal((await f.db.query('select count(*)::int c from atokore_private.photo_read_checks_v51')).rows[0].c,0);
 }finally{await f.db.close()}
});
test('fault: legacy write paths still open, or the legacy object rewritten after the copy -> never deleted',async()=>{
 const f=await fixture({writesOpen:true});
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  let r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'});
  assert.deepEqual([r.status,r.held],['verified','legacy_writes_open']);
  await f.db.exec(SQL('atokore-photo-legacy-close-writes-v51.sql'));
  // The legacy object is written again (an old client before stage 1) after the copy.
  await bump(f,LEGACY,f.legacy.item_move_0001);
  r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'});
  assert.deepEqual([r.status,r.held],['verified','legacy_changed']);
  assert.deepEqual(f.storage.removed,[]);
  // A move whose legacy object changed WHILE copying is abandoned (the copy may be of other bytes).
  const m=await f.sql('photo_legacy_begin_v51',[f.h,'item_move_0002']);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await bump(f,LEGACY,m.legacy_path);
  assert.deepEqual(await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.sourceSha,c.targetSha]),{status:'abandoned',why:'legacy_changed',reused:false});
  assert.equal((await f.rec('item_move_0002')).p,f.legacy.item_move_0002);
 }finally{await f.db.close()}
});
test('fault: the delete answer is lost after the delete happened -> the next run finishes; interrupted runs resume',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=(await mods)[0];
  const realRemove=f.storage.remove.bind(f.storage);
  f.storage.remove=async(b,p)=>{await realRemove(b,p);throw Error('response lost')};
  let r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0001'});
  assert.equal(r.status,'done','the object is gone, so the move is finished');
  f.storage.remove=realRemove;
  // Interrupted after the backup, before the delete: a new run reads again and completes.
  const m=await f.sql('photo_legacy_begin_v51',[f.h,'item_move_0002']);
  const c=await f.storage.copy(LEGACY,m.legacy_path,V2,m.target_path);
  await f.sql('photo_legacy_commit_v51',[m.file_id,c.bytes,c.sourceSha,c.targetSha]);
  r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:'item_move_0002'});
  assert.equal(r.status,'done');
  assert.equal((await f.gatewayRead('B',(await f.rec('item_move_0002')).p)).status,200);
 }finally{await f.db.close()}
});
test('fault: an orphan rewritten between listing and deleting is kept (generation)',async()=>{
 const f=await fixture();
 try{
  const {runOrphanPass}=(await mods)[0];
  const p=f.h+'/item_move_0003/'+randomUUID()+'.jpg';
  await f.db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days')",[V2,p]);
  const racing=async(fn,args)=>{if(fn==='photo_orphan_object_ok_v51')await bump(f,V2,p);return f.sql(fn,args)};
  const r=await runOrphanPass({sql:racing,storage:f.storage});
  assert.deepEqual(r.kept.map(x=>x.why),['now_ledgered_referenced_or_changed']);
  assert.ok((await f.objects(V2)).includes(p));
  assert.equal(await f.sql('photo_orphan_object_ok_v51',[p,await genOf(f,V2,p)]),true,'the same generation may go');
 }finally{await f.db.close()}
});
