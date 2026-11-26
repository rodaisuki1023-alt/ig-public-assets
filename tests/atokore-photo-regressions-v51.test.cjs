// Work 6th (625ee58) reproduced failures, driven only through the worker and the close SQL so the same
// test runs on the old and the fixed drafts: before the fix these FAIL, after it they PASS.
//  A-1  resuming a 'verified' move while the moved copy reads back as 502 still deleted the legacy photo
//  A-2  the legacy photo was deleted and then could not be restored (restore needed the legacy object)
//  B-1  a read check, then different bytes at the same path (gateway 502), and the bucket still closed
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),jpeg=require('jpeg-js');
const {createDb,call}=require('./household/pg.cjs');
const SQL=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000005a1',SA='00000000-0000-4000-9000-0000000005a1';
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2',BACKUP='atokore-photo-backup-v51';
const sha=b=>createHash('sha256').update(b).digest('hex');
const photo=seed=>{const d=Buffer.alloc(8*8*4);for(let i=0;i<64;i++){d[i*4]=(seed*37+i)%256;d[i*4+1]=seed*11%256;d[i*4+2]=i*3%256;d[i*4+3]=255}return new Uint8Array(jpeg.encode({data:d,width:8,height:8},80).data)};
const worker=import('../supabase/proposals/photo-orphan-worker-v51.mjs');
async function fixture(){
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
  async remove(bucket,p){this.removed.push(bucket+':'+p);bytes.delete(bucket+':'+p);await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,p]);return true},
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
  const realRemove=f.storage.remove;f.storage.remove=async()=>false;
  const first=await moveLegacyPhoto({sql:f.sql,storage:f.storage,household:f.h,record:f.id});
  assert.equal(first.status,'verified');
  f.storage.remove=realRemove;
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
