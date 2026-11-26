// v51 photo A drafts (isolated PGlite; Storage is a fake that only edits storage.objects rows here).
// Legacy reference -> managed ledger move, its recovery after failures, and the orphan clean-up pass.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDb,call}=require('./household/pg.cjs');
const SQL=f=>fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8');
const A='00000000-0000-4000-8000-0000000002a1',B='00000000-0000-4000-8000-0000000002b1';
const SA='00000000-0000-4000-9000-0000000002a1';
const LEGACY='atokore-product-photos',V2='atokore-private-photos-v2',SHA='b'.repeat(64);
let n=1;const oid=()=>`30000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const worker=import('../supabase/proposals/photo-orphan-worker-v51.mjs');
async function fixture(){
 const db=await createDb();
 await db.exec(SQL('atokore-photo-gateway-v50.sql'));
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[SA,A]);
 const h=(await call(db,A,'hh_create',{p_name:'QA move',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 const legacy={};
 for(const id of ['item_move_0001','item_move_0002']){
  await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'create',kind:'item',id,fields:{name:'合成 '+id,unit:'個'},qty:1,ts:Date.now()}]});
  legacy[id]=h+'/'+id+'/'+oid()+'.jpg';
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY,legacy[id]]);
  await db.query("update atokore_private.records set fields=fields||jsonb_build_object('photoPath',$1::text) where id=$2",[legacy[id],id]);
 }
 for(const f of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql','atokore-photo-legacy-migrate-v51.sql'])await db.exec(SQL(f));
 await db.query("INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING",[V2]);
 const sql=async(fn,args)=>(await db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('select atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows})).at(0).r;
 const objects=async bucket=>(await db.query('select name from storage.objects where bucket_id=$1 order by name',[bucket])).rows.map(r=>r.name);
 const photo=async id=>(await db.query("select fields->>'photoPath' p,seq from atokore_private.records where id=$1",[id])).rows[0];
 const ledger=async file=>(await db.query('select state from atokore_private.photo_ledger_v50 where file_id=$1',[file])).rows[0]?.state;
 const move=async file=>(await db.query('select state,attempts from atokore_private.photo_legacy_moves_v51 where file_id=$1',[file])).rows[0];
 // Fake Storage: remove() can be told to fail; copy() writes the target row and reports hashes.
 const storage={fail:false,removed:[],async remove(bucket,p){if(this.fail)return false;this.removed.push(bucket+':'+p);await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,p]);return true}};
 const copy=async(from,to)=>{await db.query('insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing',[V2,to]);return {bytes:900,legacySha:SHA,copySha:SHA}};
 return {db,h,legacy,sql,objects,photo,ledger,move,storage,copy};
}
test('no client can call the migration or clean-up functions',async()=>{
 const {db}=await fixture();
 try{
  for(const role of ['anon','authenticated']){
   const q=await db.query("select has_function_privilege($1,'atokore_private.photo_legacy_commit_v51(uuid,integer,text,text)','EXECUTE') c,has_function_privilege($1,'atokore_private.photo_orphans_v51(integer,interval)','EXECUTE') o",[role]);
   assert.deepEqual(q.rows[0],{c:false,o:false});
  }
 }finally{await db.close()}
});
test('move: the record keeps its legacy photo until the verified copy is switched in one step; every step can be retried',async()=>{
 const {db,h,legacy,sql,objects,photo,ledger,move,storage}=await fixture();
 try{
  const id='item_move_0001',before=await photo(id);
  const m=await sql('photo_legacy_begin_v51',[h,id]);
  assert.equal(m.legacy_path,legacy[id]);assert.equal(m.reused,false);
  // Worker crashed before copying: begin again returns the same target, nothing new is created.
  const again=await sql('photo_legacy_begin_v51',[h,id]);
  assert.deepEqual([again.file_id,again.target_path,again.reused],[m.file_id,m.target_path,true]);
  assert.equal((await move(m.file_id)).attempts,2);
  // Commit refuses an unverified or missing copy and changes nothing.
  await assert.rejects(sql('photo_legacy_commit_v51',[m.file_id,900,SHA,'c'.repeat(64)]),/photo_copy_unverified/);
  await assert.rejects(sql('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA]),/photo_storage_unconfirmed/);
  assert.deepEqual(await photo(id),before);assert.equal(await ledger(m.file_id),'uploading');
  // A client still cannot write a photoPath of its own (the v50 guard is unchanged).
  await assert.rejects(call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id,field:'photoPath',value:m.target_path,ts:Date.now()+1000}]}),/photo_reference_requires_gateway/);
  assert.equal((await photo(id)).p,legacy[id]);
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[V2,m.target_path]);
  const done=await sql('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA]);
  assert.equal(done.status,'switched');
  assert.equal((await photo(id)).p,m.target_path);assert.ok(Number((await photo(id)).seq)>Number(before.seq),'other phones see the change');
  assert.equal(await ledger(m.file_id),'attached');
  // The answer was lost; the retried commit returns the same result and changes nothing.
  assert.deepEqual(await sql('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA]),{status:'switched',path:m.target_path,reused:true});
  // Finish only after the legacy object is really gone.
  assert.equal(await sql('photo_legacy_finish_v51',[m.file_id,true]),false);
  await storage.remove(LEGACY,legacy[id]);
  assert.equal(await sql('photo_legacy_finish_v51',[m.file_id,false]),false,'needs the Storage API confirmation');
  assert.equal(await sql('photo_legacy_finish_v51',[m.file_id,true]),true);
  assert.equal((await move(m.file_id)).state,'done');
  await assert.rejects(sql('photo_legacy_begin_v51',[h,id]),/photo_not_legacy/,'already managed');
  assert.deepEqual(await objects(V2),[m.target_path]);
  // The moved photo is still served to members through the gateway.
  const ok=(await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[B]);return (await tx.query("select public.hh_photo_access($1,'read') ok",[m.target_path])).rows})).at(0).ok;
  assert.equal(ok,true);
 }finally{await db.close()}
});
test('move: if the product changes while copying, the person\'s change wins and the copy is collected as an orphan',async()=>{
 const {db,h,legacy,sql,objects,photo,ledger,move,storage,copy}=await fixture();
 try{
  const id='item_move_0002';
  const m=await sql('photo_legacy_begin_v51',[h,id]);
  await copy(m.legacy_path,m.target_path);
  // The person deletes the product meanwhile (an ordinary sync write).
  assert.equal((await call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'delete',kind:'item',id,ts:Date.now()+2000}]})).results[0].status,'applied');
  assert.deepEqual(await sql('photo_legacy_commit_v51',[m.file_id,900,SHA,SHA]),{status:'abandoned',reused:false});
  assert.equal(await ledger(m.file_id),'retired');assert.equal((await move(m.file_id)).state,'abandoned');
  assert.equal((await photo(id)).p,legacy[id],'the tombstone keeps its legacy path for review; nothing is overwritten');
  const {runOrphanPass}=await worker;
  storage.fail=true;
  let r=await runOrphanPass({sql,storage});
  assert.equal(r.failed.length,1,'Storage failed: the row stays purging for the next pass');
  assert.equal(await ledger(m.file_id),'purging');
  storage.fail=false;
  r=await runOrphanPass({sql,storage});
  assert.deepEqual(r.purged,[m.file_id]);assert.equal(await ledger(m.file_id),'purged');
  assert.deepEqual(await objects(V2),[]);
  assert.deepEqual(await objects(LEGACY),Object.values(legacy).sort(),'legacy objects are never touched by the clean-up');
  r=await runOrphanPass({sql,storage});
  assert.deepEqual([r.purged,r.retired,r.removedOrphans,r.failed],[[],[],[],[]],'a second pass changes nothing');
 }finally{await db.close()}
});
test('clean-up pass: retires expired reservations, removes old unledgered objects, never a referenced or attached one, reports stuck uploads',async()=>{
 const {db,h,sql,objects,ledger,storage,copy}=await fixture();
 try{
  const {runOrphanPass,moveLegacyPhoto}=await worker;
  // An attached (moved) photo, which must survive every pass.
  const moved=await moveLegacyPhoto({sql,storage,copy,household:h,record:'item_move_0001'});
  assert.equal(moved.status,'done');
  // An expired reservation (never uploaded), an old object with no ledger row, a fresh one, a stuck upload.
  const res=await db.query("insert into atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_seq,state,expires_at) values($1,'item_move_0002',$2,gen_random_uuid(),1,'reserved',now()-interval '1 minute') returning file_id",[h,A]);
  const expired=res.rows[0].file_id;
  const oldOrphan=h+'/item_move_0002/'+oid()+'.jpg',freshOrphan=h+'/item_move_0002/'+oid()+'.jpg';
  await db.query("insert into storage.objects(bucket_id,name,created_at) values($1,$2,now()-interval '2 days'),($1,$3,now())",[V2,oldOrphan,freshOrphan]);
  const r=await runOrphanPass({sql,storage});
  assert.deepEqual(r.retired,[expired]);
  assert.deepEqual(r.removedOrphans,[oldOrphan]);
  assert.ok((await objects(V2)).includes(freshOrphan),'within the grace period: kept (it may be an upload in flight)');
  assert.ok((await objects(V2)).includes(moved.path),'attached photo kept');
  // The retired reservation is purged on the next pass (no object existed; finish confirms absence).
  const r2=await runOrphanPass({sql,storage});
  assert.deepEqual(r2.purged,[expired]);assert.equal(await ledger(expired),'purged');
  assert.ok((await objects(V2)).includes(moved.path));
  // A stuck upload is only reported, never retired or deleted by time.
  const stuck=(await db.query("insert into atokore_private.photo_ledger_v50(household_id,record_id,actor,operation_id,expected_seq,state,expires_at) values($1,'item_move_0002',$2,gen_random_uuid(),1,'uploading',now()-interval '3 days') returning file_id",[h,A])).rows[0].file_id;
  const r3=await runOrphanPass({sql,storage});
  assert.deepEqual(r3.reported.map(x=>[x.action,x.file_id]),[['report_stuck_upload',stuck]]);
  assert.equal(await ledger(stuck),'uploading');
  // orphan_object_ok re-checks right before deleting: a path that is attached is refused.
  assert.equal(await sql('photo_orphan_object_ok_v51',[moved.path]),false);
 }finally{await db.close()}
});
test('with the migrate draft applied, a member who left cannot reserve, and hh_push still cannot clear a legacy path',async()=>{
 const {db,h,legacy}=await fixture();
 try{
  await assert.rejects(call(db,A,'hh_push',{p_ops:[{op_id:oid(),type:'set',kind:'item',id:'item_move_0002',field:'photoPath',value:null,ts:Date.now()+3000}]}),/photo_reference_requires_gateway/);
  assert.equal((await db.query("select fields->>'photoPath' p from atokore_private.records where id='item_move_0002'")).rows[0].p,legacy.item_move_0002);
  await call(db,A,'hh_remove_member',{p_user:B});
  const asB=await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[B]);await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:B,session_id:SA})]);
   return tx.query("select atokore_private.photo_reserve_v50($1,'item_move_0002',gen_random_uuid(),$2) r",[h,legacy.item_move_0002]).then(()=>'ok',e=>e.message)});
  assert.match(asB,/photo_denied/);
 }finally{await db.close()}
});
