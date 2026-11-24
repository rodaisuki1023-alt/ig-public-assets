// Isolated PGlite test only; storage metadata below is a mock, NOT a real file operation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDb,call}=require('./household/pg.cjs');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const SA='00000000-0000-4000-9000-000000000001',SB='00000000-0000-4000-9000-000000000002';
let n=0;const op=()=>('00000000-0000-4000-8000-'+String(++n+500).padStart(12,'0'));
const R='photo_item_0',BUCKET='atokore-private-photos-v2';
async function fixture(){
 const db=await createDb();
 await db.exec('CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz)');
 for(const [id,u] of [[SA,A],[SB,B]])await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[id,u]);
 for(const f of ['atokore-photo-reservation-v50.sql','atokore-photo-lifecycle-v50.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/proposals',f),'utf8'));
 await db.query('INSERT INTO storage.buckets(id,name,public) VALUES($1,$1,false) ON CONFLICT(id) DO NOTHING',[BUCKET]);
 const h=(await call(db,A,'hh_create',{p_name:'QA lifecycle',p_display_name:'A'})).household.id;
 const {code}=await call(db,A,'hh_invite_create');await call(db,B,'hh_join',{p_code:code,p_display_name:'B'});
 const push=(uid,fields)=>call(db,uid,'hh_push',{p_ops:[{op_id:op(),kind:'item',id:R,ts:Date.now(),...fields}]});
 assert.equal((await push(A,{type:'create',qty:1,fields:{name:'合成商品',unit:'個'}})).results[0].status,'applied');
 const invoke=(uid,sid,fn,args)=>db.transaction(async tx=>{
  await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid]);
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,session_id:sid})]);
  return (await tx.query('SELECT atokore_private.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows[0].r;
 });
 const a=(fn,...args)=>invoke(A,SA,fn,args),b=(fn,...args)=>invoke(B,SB,fn,args);
 const reserve=async(expected=null)=> (await a('photo_reserve_v50',h,R,op(),expected)).file_id;
 const prepare=async(expected=null)=>{
  const file=await reserve(expected),p=await a('photo_begin_v50',h,R,file);
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[BUCKET,p]);
  assert.equal(await a('photo_finish_v50',h,R,file,631),true);
  return {file,p};
 };
 const row=async()=> (await db.query("SELECT seq,qty,fields->>'photoPath' AS photo FROM atokore_private.records WHERE household_id=$1 AND kind='item' AND id=$2",[h,R])).rows[0];
 const state=async(file)=>(await db.query('SELECT state FROM atokore_private.photo_ledger_v50 WHERE file_id=$1',[file])).rows[0].state;
 return {db,h,a,b,push,reserve,prepare,row,state};
}
test('lifecycle: no client grants; duplicate begin, absent storage and invalid size fail closed',async()=>{
 const {db,h,a,reserve,state}=await fixture();
 try{
  for(const role of ['anon','authenticated']){
   const q=await db.query("SELECT has_function_privilege($1,'atokore_private.photo_attach_v50(uuid,text,uuid)','EXECUTE') a,has_function_privilege($1,'atokore_private.photo_finish_purge_v50(uuid,boolean)','EXECUTE') p",[role]);
   assert.deepEqual(q.rows[0],{a:false,p:false});
  }
  const file=await reserve();await a('photo_begin_v50',h,R,file);
  await assert.rejects(a('photo_begin_v50',h,R,file),/photo_begin_conflict/);
  await assert.rejects(a('photo_finish_v50',h,R,file,81921),/photo_invalid_size/);
  await assert.rejects(a('photo_finish_v50',h,R,file,10),/photo_storage_unconfirmed/);
  assert.equal(await state(file),'uploading');
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET expires_at=now()-interval '1 second' WHERE file_id=$1",[file]);
  assert.equal(await a('photo_retire_expired_v50',file),false);
  await assert.rejects(a('photo_claim_purge_v50',file),/photo_purge_conflict/);
 }finally{await db.close()}
});
test('lifecycle: stale revision and removed member cannot attach a photo',async()=>{
 const {db,h,a,b,push,prepare,row,state}=await fixture();
 try{
  const {file}=await prepare();
  await assert.rejects(b('photo_attach_v50',h,R,file),/photo_denied/);
  assert.equal((await push(B,{type:'delta',delta:1})).results[0].status,'applied');
  await assert.rejects(a('photo_attach_v50',h,R,file),/photo_stale_reference/);
  assert.equal((await row()).photo,null);assert.equal(await state(file),'uploaded');
  const bid=(await b('photo_reserve_v50',h,R,op(),null).catch(e=>{assert.match(e.message,/photo_pending_item/);return null}));
  assert.equal(bid,null);
  await db.query("UPDATE atokore_private.photo_ledger_v50 SET expires_at=now()-interval '1 second' WHERE file_id=$1",[file]);
  assert.equal(await a('photo_retire_expired_v50',file),true);
  const bf=(await b('photo_reserve_v50',h,R,op(),null)).file_id;
  const bp=await b('photo_begin_v50',h,R,bf);
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[BUCKET,bp]);
  await b('photo_finish_v50',h,R,bf,631);
  await call(db,A,'hh_remove_member',{p_user:B});
  await assert.rejects(b('photo_attach_v50',h,R,bf),/photo_denied/);
  assert.equal((await row()).photo,null);
 }finally{await db.close()}
});
test('lifecycle: attach, replace, detach, reference injection and confirmed purge',async()=>{
 const {db,h,a,push,prepare,row,state}=await fixture();
 try{
  const first=await prepare(),ar=await a('photo_attach_v50',h,R,first.file);
  assert.equal(ar.path,first.p);assert.equal((await row()).photo,first.p);
  assert.equal((await a('photo_attach_v50',h,R,first.file)).reused,true);
  await assert.rejects(a('photo_claim_purge_v50',first.file),/photo_purge_conflict/);
  await assert.rejects(push(B,{type:'set',field:'photoPath',value:'bogus.jpg'}),/photo_reference_requires_gateway/);
  await assert.rejects(push(B,{type:'set',field:'photoPath',value:null}),/photo_reference_requires_gateway/);
  const next=await prepare(first.p),br=await a('photo_attach_v50',h,R,next.file);
  assert.equal((await row()).photo,next.p);assert.equal(await state(first.file),'retired');
  await assert.rejects(a('photo_detach_v50',h,R,first.file,br.seq),/photo_stale_reference/);
  await assert.rejects(push(B,{type:'set',field:'photoPath',value:first.p}),/photo_reference_requires_gateway/);
  assert.equal(await a('photo_claim_purge_v50',first.file),first.p);
  assert.equal(await a('photo_finish_purge_v50',first.file,true),false);
  // MOCK fixture metadata removal simulates settled Storage API deletion.
  await db.query('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',[BUCKET,first.p]);
  assert.equal(await a('photo_finish_purge_v50',first.file,false),false);
  assert.equal(await a('photo_finish_purge_v50',first.file,true),true);
  assert.equal(await state(first.file),'purged');
  await assert.rejects(a('photo_attach_v50',h,R,first.file),/photo_attach_conflict/);
  assert.equal((await row()).photo,next.p);
  await a('photo_detach_v50',h,R,next.file,br.seq);
  assert.equal((await row()).photo,null);assert.equal(await state(next.file),'retired');
  assert.equal(await a('photo_claim_purge_v50',next.file),next.p);
 }finally{await db.close()}
});
