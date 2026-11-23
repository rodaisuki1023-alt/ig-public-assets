const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const mod=import(pathToFileURL(path.join(__dirname,'../supabase/functions/_shared/photo-gateway-handler.mjs')).href);
const householdId='f2e33d46-bef7-4ed5-abb1-2e0d39b6c414';
const recordId='qa_c0e4b6f7a9_item';
const fileId='34f20801-5e2a-4bc5-967e-e77cd4c09d1b';
const userId='d0088095-0c74-4ebc-a8eb-f88c2750a796';
const photoPath=householdId+'/'+recordId+'/'+fileId+'.jpg';
const bytes=Uint8Array.from([255,216,255,224,24,2,255,217]);
const base64=Buffer.from(bytes).toString('base64');
function fixture(override={}){
 let active=true,mutate=()=>{};
 const calls={auth:0,check:0,read:0,write:0,remove:0};
 const impl={
   verifySession:async()=>{calls.auth++;return {id:userId}},
   checkCurrentAccess:async({userId:uid,householdId:hid,recordId:rid,operation})=>{
      calls.check++;assert.equal(uid,userId);assert.equal(hid,householdId);
      assert.equal(rid,recordId);assert.ok(['read','write','delete'].includes(operation));return active;
   },
   readObject:async()=>{calls.read++;mutate();return bytes},
   writeObject:async()=>{calls.write++;mutate()},
   removeObject:async()=>{calls.remove++},
   newFileId:()=>fileId,
   ...override,
 };
 return {impl,calls,revoke:()=>{active=false},onStorage:fn=>{mutate=fn}};
}
const mk=()=>({operation:'read',path:photoPath,accessToken:'synthetic.jwt.example'});
test('read: only live authorized requester receives JPEG; each read checks twice',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture();const handle=createPhotoGatewayHandler(f.impl);
 const success=await handle(mk());
 assert.equal(success.status,200);
 assert.deepEqual(Array.from(success.bytes),Array.from(bytes));
 assert.deepEqual(f.calls,{auth:2,check:2,read:1,write:0,remove:0});
 f.revoke();const denied=await handle(mk());
 assert.equal(denied.status,403);assert.equal(denied.bytes,undefined);
 assert.equal(f.calls.read,1);
});
test('read: revoked while reading rejects bytes',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture();f.onStorage(f.revoke);
 const actual=await createPhotoGatewayHandler(f.impl)(mk());
 assert.equal(actual.status,403);
 assert.equal(actual.bytes,undefined);
 assert.equal(f.calls.check,2);
});
test('write: server creates immutable path, validates JPEG, then rechecks access',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture();const handle=createPhotoGatewayHandler(f.impl);
 const ok=await handle({operation:'write',householdId,recordId,base64,accessToken:'synthetic.jwt'});
 assert.equal(ok.status,200);assert.equal(ok.path,photoPath);
 assert.equal(f.calls.check,2);assert.equal(f.calls.write,1);
 for (const v of [
   {base64:'$',operation:'write',householdId,recordId,accessToken:'synthetic.jwt'},
   {base64:'dGV4dA==',operation:'write',householdId,recordId,accessToken:'synthetic.jwt'},
   {base64:Buffer.alloc(81921).toString('base64'),operation:'write',householdId,recordId,accessToken:'synthetic.jwt'},
   {base64,operation:'write',householdId:'other-household',recordId,accessToken:'synthetic.jwt'},
   {base64,operation:'write',householdId,recordId:'..',accessToken:'synthetic.jwt'}
 ]) assert.equal((await handle(v)).status,400);
 assert.equal(f.calls.write,1);
});
test('write: revocation during upload attempts cleanup and never returns path',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture();f.onStorage(f.revoke);
 const res=await createPhotoGatewayHandler(f.impl)({operation:'write',householdId,recordId,base64,accessToken:'synthetic.jwt'});
 assert.equal(res.status,403);assert.equal(res.path,undefined);
 assert.equal(f.calls.write,1);assert.equal(f.calls.remove,1);
});
test('write: cannot confirm cleanup results in 503 and no leak of object path',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture({removeObject:async()=>{throw Error('network')}});
 f.onStorage(f.revoke);
 const res=await createPhotoGatewayHandler(f.impl)({operation:'write',householdId,recordId,base64,accessToken:'synthetic.jwt'});
 assert.equal(res.status,503);assert.equal(res.error,'cleanup_unconfirmed');assert.equal(res.path,undefined);
});
test('delete: membership checked twice and no delete after removal',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const f=fixture();const handle=createPhotoGatewayHandler(f.impl);
 assert.equal((await handle({operation:'delete',path:photoPath,accessToken:'synthetic.jwt'})).deleted,true);
 assert.equal(f.calls.remove,1);assert.equal(f.calls.check,2);
 f.revoke();const denied=await handle({operation:'delete',path:photoPath,accessToken:'synthetic.jwt'});
 assert.equal(denied.status,403);assert.equal(f.calls.remove,1);
});
test('fail closed on path, auth, membership, DB and Storage errors',async()=>{
 const {createPhotoGatewayHandler}=await mod;
 const cases=[
  {operation:'read',path:photoPath,accessToken:''},
  {operation:'read',path:'../secret.jpg',accessToken:'x'},
  {operation:'other',path:photoPath,accessToken:'x'}
 ];
 const f=fixture();const handle=createPhotoGatewayHandler(f.impl);
 for(const x of cases)assert.notEqual((await handle(x)).status,200);
 for(const deps of [
  {verifySession:async()=>{throw Error('auth down')}},
  {checkCurrentAccess:async()=>{throw Error('db down')}},
  {readObject:async()=>{throw Error('storage down')}},
  {readObject:async()=>Uint8Array.from([1,2,3,4])},
 ]) {
  const res=await createPhotoGatewayHandler({...f.impl,...deps})(mk());
  assert.ok([502,503].includes(res.status));
  assert.equal(res.bytes,undefined);
 }
 assert.throws(()=>createPhotoGatewayHandler(),TypeError);
});
