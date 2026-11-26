// Work 6th (625ee58) reproduced failures, driven only through the worker and the close SQL so the same
// test runs on the old and the fixed drafts: before the fix these FAIL, after it they PASS.
//  A-1  resuming a 'verified' move while the moved copy reads back as 502 still deleted the legacy photo
//  A-2  the legacy photo was deleted and then could not be restored (restore needed the legacy object)
//  B-1  a read check, then different bytes at the same path (gateway 502), and the bucket still closed
// Work 7th (7d9442b), same approach:
//  A-3  the legacy object is overwritten after the last SQL decision, right before the external delete
//  A-4  an upload is reserved for an orphan's key after the last SQL decision, right before the delete
//  A-5  the delete happened but its answer was lost, and the look-up answers 403 / 502 / timeout
//  A-6  a restore whose read fails (502) is retried: it must read again, never become 'restored' unread
//  A-7  an adapter without a conditional delete deletes nothing (legacy, orphan, purge)
//  B-2  the bytes change but the metadata generation does not (stale): the bucket must not close
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),jpeg=require('jpeg-js');
const {createDb,call}=require('./household/pg.cjs');
const SQL=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000005a1',SA='00000000-0000-4000-9000-0000000005a1';
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2',BACKUP='atokore-photo-backup-v51';
const sha=b=>createHash('sha256').update(b).digest('hex');
const photo=seed=>{const d=Buffer.alloc(8*8*4);for(let i=0;i<64;i++){d[i*4]=(seed*37+i)%256;d[i*4+1]=seed*11%256;d[i*4+2]=i*3%256;d[i*4+3]=255}return new Uint8Array(jpeg.encode({data:d,width:8,height:8},80).data)};
const worker=import('../supabase/proposals/photo-orphan-worker-v51.mjs');
async function fixture(opts={}){
 const db=await createDb();
 await db.exec(SQL('atokore-photo-gateway-v50.sql'));
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[SA,A]);
 const h=(await call(db,A,'hh_create',{p_name:'QA regress',p_display_name:'A'})).household.id;
 const bytes=new Map(),id='item_regr_0001',legacy=h+'/'+id+'/'+randomUUID()+'.jpg';
 await call(db,A,'hh_push',{p_ops:[{op_id:randomUUID(),type:'create',kind:'item',id,fields:{name:'合成',unit:'個'},qty:1,ts:Date.now()}]});
 bytes.set(LEGACY+':'+legacy,photo(1));
 await db.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY,legacy]);
 await db.query("update atokore_private.records set fields=fields||jsonb_build_object('photoPath',$1::text) where id=$2",[legacy,id]);
 for(const f of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-service-v50.sql','atokore-photo-legacy-migrate-v51.sql','atokore-photo-legacy-close-writes-v51.sql'])await db.exec(SQL(f));
 for(const b of [V2,BACKUP])await db.query("INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING",[b]);
 await db.query("INSERT INTO atokore_private.trial_households_v51(household_id,label) VALUES($1,'QA regress')",[h]);
 const sql=async(fn,args)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('select atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows})).at(0).r;
 const objects=async b=>(await db.query('select name from storage.objects where bucket_id=$1',[b])).rows.map(r=>r.name);
 // Fake Storage. copy() takes (from,to) [legacy -> managed] or (fromBucket,from,toBucket,to).
 const storage={fail502:new Set(),removed:[],
  async download(bucket,p){if(this.fail502.has(p))throw Object.assign(Error('502'),{status:502});const b=bytes.get(bucket+':'+p);if(!b)throw Error('absent');return b},
  // The plain delete (used by the drafts before Work 7th): same fault hooks, so the same scenario runs on both.
  async remove(bucket,p){
   if(this.beforeRemove){const f=this.beforeRemove;this.beforeRemove=null;await f(bucket,p)}
   if(this.removeError&&!this.removeAfterError)throw Error(this.removeError);
   this.removed.push(bucket+':'+p);bytes.delete(bucket+':'+p);await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,p]);
   if(this.removeError&&this.removeAfterError)throw Error(this.removeError);
   return true},
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
  async copy(...a){const [fb,f,tb,t]=a.length===2?[LEGACY,a[0],V2,a[1]]:a;const b=bytes.get(fb+':'+f);if(!b)throw Error('absent');
   if(!bytes.has(tb+':'+t)){bytes.set(tb+':'+t,b);await db.query('insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing',[tb,t])}
   const back=bytes.get(tb+':'+t);return {bytes:back.length,legacySha:sha(b),copySha:sha(back),sourceSha:sha(b),targetSha:sha(back)}}};
 return {db,h,id,legacy,bytes,sql,objects,storage};
}
test('A-1 (Work): resuming a verified move whose copy reads back 502 must not delete the legacy photo',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=await worker;
  // Reach 'verified' and stop before the delete (the delete step fails once).
  f.storage.removeError='timeout';f.storage.statError='502';          // the delete answer is lost and the look-up is unclear
  const first=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.deepEqual([first.status,first.held],['verified','delete_unconfirmed']);
  f.storage.removeError=null;f.storage.statError=null;
  // The moved copy now answers 502 through the gateway path; resuming must read again and stop.
  const target=(await f.db.query("select fields->>'photoPath' p from atokore_private.records where id=$1",[f.id])).rows[0].p;
  f.storage.fail502.add(target);
  const again=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.notEqual(again.status,'done','must not finish while the copy cannot be read');
  assert.ok((await f.objects(LEGACY)).includes(f.legacy),'the legacy photo is still there');
  assert.deepEqual(f.storage.removed,[]);
 }finally{await f.db.close()}
});
test('A-2 (Work): after the legacy photo was deleted, a restore still brings back a readable photo with the original bytes',async()=>{
 const f=await fixture();
 try{
  const m=await import('../supabase/proposals/photo-orphan-worker-v51.mjs');
  const done=await m.moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(done.status,'done');
  assert.equal((await f.objects(LEGACY)).includes(f.legacy),false);
  assert.equal(typeof m.restoreLegacyPhoto,'function','a restore path that works without the legacy object');
  const r=await m.restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:done.file_id});
  assert.equal(r.status,'restored');
  const now=(await f.db.query("select fields->>'photoPath' p from atokore_private.records where id=$1",[f.id])).rows[0].p;
  assert.notEqual(now,f.legacy);
  assert.equal(sha(await f.storage.download(V2,now)),sha(photo(1)),'same bytes as the original photo');
  assert.equal((await m.checkRead({sql:f.sql,storage:f.storage},r.file_id)).ok,true,'readable the way the gateway reads it');
 }finally{await f.db.close()}
});
test('B-1 (Work): a read check followed by different bytes at the same path (502) must not let the bucket close',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=await worker;
  const done=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(done.status,'done');
  // Same path, new bytes (an overwrite outside the ledger): the gateway now answers 502.
  const p=(await f.db.query("select fields->>'photoPath' p from atokore_private.records where id=$1",[f.id])).rows[0].p;
  f.bytes.set(V2+':'+p,photo(9));
  await f.db.query("update storage.objects set updated_at=now()+interval '1 second',metadata=jsonb_build_object('eTag','changed') where bucket_id=$1 and name=$2",[V2,p]);
  await assert.rejects(f.db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql')),/photo_unread_remain|photo_ledger_inconsistent/);
 }finally{await f.db.close()}
});

// ---------------------------------------------------------------- Work 7th
const bumpObject=(f,bucket,p,seed)=>{f.bytes.set(bucket+':'+p,photo(seed));return f.db.query("update storage.objects set updated_at=updated_at+interval '1 second',metadata=coalesce(metadata,'{}')||jsonb_build_object('eTag',md5(random()::text)) where bucket_id=$1 and name=$2",[bucket,p])};
test('A-3 (Work 7th): the legacy object rewritten after the final SQL decision, right before the delete -> deleted 0',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=await worker;
  f.storage.beforeRemove=(b,p)=>bumpObject(f,b,p,7);                       // injected at the race point
  const r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.notEqual(r.status,'done');
  assert.deepEqual(f.storage.removed,[],'nothing was deleted');
  assert.ok((await f.objects(LEGACY)).includes(f.legacy),'the rewritten legacy object is kept');
 }finally{await f.db.close()}
});
test('A-4 (Work 7th): an orphan reserved after the final SQL decision is never left reserved-but-deleted',async()=>{
 const f=await fixture();
 try{
  const {runOrphanPass}=await worker;
  const file=randomUUID(),p=f.h+'/'+f.id+'/'+file+'.jpg';
  f.bytes.set(V2+':'+p,photo(5));
  await f.db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days')",[V2,p]);
  let injected=null;
  f.storage.beforeRemove=async()=>{try{await f.db.query("insert into atokore_private.photo_ledger_v50(file_id,household_id,record_id,actor,operation_id,expected_seq,state,expires_at) values($1,$2,$3,$4,gen_random_uuid(),1,'uploading',now()+interval '5 minutes')",[file,f.h,f.id,A]);injected='reserved'}catch(e){injected=e.message}};
  await runOrphanPass({sql:f.sql,storage:f.storage});
  const ledgered=(await f.db.query('select count(*)::int c from atokore_private.photo_ledger_v50 where file_id=$1',[file])).rows[0].c===1;
  const present=(await f.objects(V2)).includes(p);
  assert.ok(!(ledgered&&!present),'a reservation must never point at an object deleted under it (injection: '+injected+')');
  if(!ledgered)assert.match(injected,/photo_path_being_deleted/,'the reservation was refused while the key was being deleted');
 }finally{await f.db.close()}
});
for(const why of ['403','502','timeout'])test(`A-5 (Work 7th): the delete answer is lost and the look-up answers ${why} -> pending, never done by guess`,async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=await worker;
  f.storage.removeError='lost';f.storage.removeAfterError=true;f.storage.statError=why;
  const r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.notEqual(r.status,'done','an unclear outcome is not a confirmed absence');
  f.storage.removeError=null;f.storage.statError=null;
  const again=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(again.status,'done','an authoritative look-up later confirms it');
 }finally{await f.db.close()}
});
test('A-6 (Work 7th): a restore whose read fails is retried with a read; it is never restored unread',async()=>{
 const f=await fixture();
 try{
  const m=await worker;
  const done=await m.moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(done.status,'done');
  // The restore copies the backup to a new id; its read answers 502 (twice).
  const realCopy=f.storage.copy.bind(f.storage);
  f.storage.copy=async(...a)=>{const c=await realCopy(...a);if(a[2]===V2)f.storage.fail502.add(a[3]);return c};
  const r1=await m.restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:done.file_id});
  assert.notEqual(r1.status,'restored');
  const r2=await m.restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:done.file_id});
  assert.notEqual(r2.status,'restored','the retry read again and failed again');
  f.storage.fail502.clear();
  const r3=await m.restoreLegacyPhoto({sql:f.sql,storage:f.storage,file:done.file_id});
  assert.equal(r3.status,'restored');
  const now=(await f.db.query("select fields->>'photoPath' p from atokore_private.records where id=$1",[f.id])).rows[0].p;
  assert.equal(sha(await f.storage.download(V2,now)),sha(photo(1)));
 }finally{await f.db.close()}
});
test('A-7 (Work 7th): an adapter that cannot delete conditionally deletes nothing; the backup is still made',async()=>{
 const f=await fixture({capable:false});
 try{
  const {moveLegacyPhoto,runOrphanPass}=await worker;
  const r=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(r.status,'verified');
  const p=f.h+'/'+f.id+'/'+randomUUID()+'.jpg';
  f.bytes.set(V2+':'+p,photo(3));
  await f.db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days')",[V2,p]);
  await runOrphanPass({sql:f.sql,storage:f.storage});
  assert.deepEqual(f.storage.removed,[],'nothing deleted anywhere');
  assert.ok((await f.objects(LEGACY)).includes(f.legacy));
  assert.ok((await f.objects(V2)).includes(p));
  assert.equal((await f.objects(BACKUP)).length,1,'the legacy bytes were backed up');
 }finally{await f.db.close()}
});
test('B-2 (Work 7th): the bytes change while the metadata generation stays the same -> the bucket does not close',async()=>{
 const f=await fixture();
 try{
  const {moveLegacyPhoto}=await worker;
  assert.equal((await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id})).status,'done');
  const p=(await f.db.query("select fields->>'photoPath' p from atokore_private.records where id=$1",[f.id])).rows[0].p;
  f.bytes.set(V2+':'+p,photo(9));                                           // bytes changed, metadata not (yet)
  await assert.rejects(f.db.exec(SQL('atokore-photo-legacy-close-reads-v51.sql')),/storage_guarantee_unproven|photo_unread_remain/);
  await f.db.exec('rollback').catch(()=>{});
  assert.ok((await f.db.query("select count(*)::int c from pg_policies where schemaname='storage' and policyname='atokore_photo_read'")).rows[0].c===1,'nothing closed');
 }finally{await f.db.close()}
});
