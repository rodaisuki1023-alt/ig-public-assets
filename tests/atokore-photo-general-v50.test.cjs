const test=require('node:test'),assert=require('node:assert/strict');
const jpeg=require('jpeg-js');
const H='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',F='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',R='photo_item_0',P=H+'/'+R+'/'+F+'.jpg';
const sample=Uint8Array.from(jpeg.encode({width:8,height:8,data:Buffer.alloc(8*8*4,180)},78).data);
const request={operation:'write',householdId:H,recordId:R,operationId:O,expectedPath:null,expectedSeq:1,base64:Buffer.from(sample).toString('base64')};
const mod=import('../supabase/proposals/photo-general-v50.mjs');
test('actual JPEG decode, re-encode, bounded dimensions and malformed/polyglot rejection',async()=>{
 const m=await mod,n=m.makeJpegNormalizer(jpeg);
 assert.deepEqual(m.jpegFrame(sample),{width:8,height:8,components:3});
 assert.ok(n(sample));
 for(const b of [Uint8Array.from([255,216,255,217]),sample.slice(0,-2),Uint8Array.from([...sample,0,255,217]),Uint8Array.from(jpeg.encode({width:257,height:1,data:Buffer.alloc(257*4)},78).data)]){
  assert.equal(n(b),null);
 }
 const truncated=Uint8Array.from([...sample.slice(0,-25),255,217]);assert.equal(n(truncated),null);
});
async function fixture(){
 const m=await mod;let state=null,object=null,uploads=0,revoked=false,readCalls=0,loseResponse=false,sha=null;
 const deny=()=>{throw Object.assign(Error('denied'),{code:'42501'})};
 const h=m.createGeneralPhotoHandler({
  verify:async t=>t==='valid'?{uid:U,session:S}:null,
  normalize:m.makeJpegNormalizer(jpeg),
  db:async(user,action,f)=>{
   if(revoked)deny();
   if(action==='read'){if(state!=='attached'||f.p_file!==F)deny();readCalls++;return {path:P,sha,bytes:object.length}}
   if(action==='reserve'){
    if(state&&sha!==f.p_sha)throw Object.assign(Error('conflict'),{code:'23505'});
    if(!state){state='reserved';sha=f.p_sha}
    return {file_id:F,path:P,state,sha,current:state==='attached',seq:state==='attached'?2:1}
   }
   if(action==='begin'){assert.equal(state,'reserved');state='uploading';return {path:P}}
   if(action==='finish'){assert.ok(object);state='uploaded';return {ok:true}}
   if(action==='attach'){assert.equal(state,'uploaded');state='attached';return {path:P,seq:2}}
   if(action==='detach'){state='retired';return {seq:3}}
   throw Error('unexpected')
  },
  storage:{
   upload:async(path,b)=>{assert.equal(path,P);uploads++;object=b;if(loseResponse)throw Error('response lost')},
   download:async(path)=>{assert.equal(path,P);if(!object)throw Error('not found');return object}
  }
 });
 return {h,setLost:()=>loseResponse=true,rev:()=>revoked=true,stats:()=>({uploads,readCalls,state}),corrupt:()=>{object=Uint8Array.from([255,216,255,217])}};
}
test('lost upload response recovers exact committed bytes without a second upload',async()=>{
 const x=await fixture();x.setLost();
 assert.equal((await x.h(request,'valid')).error,'upload_pending');
 assert.equal(x.stats().uploads,1);
 assert.equal((await x.h(request,'valid')).status,200);
 assert.equal((await x.h(request,'valid')).reused,true);
 assert.equal(x.stats().uploads,1);
 const read=await x.h({operation:'read',path:P},'valid');
 assert.equal(read.status,200);assert.equal(x.stats().readCalls,2);
 x.rev();assert.equal((await x.h({operation:'read',path:P},'valid')).status,403);
});
test('wrong hash/invalid image, unauthenticated and malformed paths fail closed',async()=>{
 const x=await fixture();
 assert.equal((await x.h(request,'invalid')).status,401);
 assert.equal((await x.h({...request,base64:'//j/2Q=='},'valid')).status,400);
 assert.equal((await x.h(request,'valid')).status,200);
 assert.equal((await x.h({operation:'read',path:P+'\n'},'valid')).status,400);
 x.corrupt();assert.equal((await x.h({operation:'read',path:P},'valid')).status,502);
});
test('purge worker never marks complete on Storage error or invalid claim',async()=>{
 const m=await mod;let called=0;
 const worker=async(action)=>{if(action==='claim_purge')return {path:P};called++;return {ok:true}};
 await assert.rejects(m.purgeRetired({worker,storage:{remove:async()=>{throw Error('timeout')}}},F),/timeout/);
 assert.equal(called,0);
 assert.equal(await m.purgeRetired({worker,storage:{remove:async()=>{}}},F),true);
 assert.equal(called,1);
});
test('revocation between read checks never releases bytes',async()=>{
 const m=await mod,n=m.makeJpegNormalizer(jpeg),bytes=n(sample),sha=await m.sha256(bytes);let count=0;
 const h=m.createGeneralPhotoHandler({verify:async()=>({uid:U,session:S}),normalize:n,
  db:async()=>{if(++count===2)throw Object.assign(Error('revoked'),{code:'42501'});return {path:P,sha,bytes:bytes.length}},
  storage:{download:async()=>bytes,upload:async()=>{throw Error('unexpected')}}});
 assert.deepEqual(await h({operation:'read',path:P},'valid'),{status:403,error:'denied'});
});

test('expired unknown upload is held; positive hash-matched settlement can purge',async()=>{
 const m=await mod,bytes=m.makeJpegNormalizer(jpeg)(sample),sha=await m.sha256(bytes);
 let remove=0,settle=0,unknown=true;
 const worker=async(action,file,f)=>{
  if(action==='inspect_expired')return {ok:true,state:'uploading',path:P,sha};
  if(action==='settled_upload'){assert.equal(f.p_sha,sha);settle++;return {ok:true}}
  if(action==='claim_purge')return {path:P};
  if(action==='finish_purge')return {ok:true};
  throw Error('unexpected');
 };
 const storage={download:async()=>{if(unknown)throw Error('timeout');return bytes},remove:async()=>{remove++}};
 assert.deepEqual(await m.reconcileExpired({worker,storage},F),{state:'held'});
 assert.equal(remove,0);assert.equal(settle,0);
 unknown=false;assert.deepEqual(await m.reconcileExpired({worker,storage},F),{state:'purged'});
 assert.equal(remove,1);assert.equal(settle,1);
});
