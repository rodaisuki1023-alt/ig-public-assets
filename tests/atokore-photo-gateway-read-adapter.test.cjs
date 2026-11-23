const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const implementation = import(pathToFileURL(path.join(__dirname, '../scripts/atokore/photo-gateway-read-adapter.mjs')).href);
const hh='f2e33d46-bef7-4ed5-abb1-2e0d39b6c414';
const item='qa_c0e4b6f7a9_item';
const file='34f20801-5e2a-4bc5-967e-e77cd4c09d1b';
const photoPath=hh+'/'+item+'/'+file+'.jpg';
const user='d0088095-0c74-4ebc-a8eb-f88c2750a796';
const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xe0,3,2,0xff,0xd9]);
const request={method:'POST',authorization:'Bearer mock.jwt.token',path:photoPath};

function fixture(changes={}) {
  const calls={auth:0,membership:0,storage:0};
  let allowed=true;
  const gate={
    verifySession:async()=>{calls.auth++;return {id:user}},
    checkCurrentAccess:async({userId,householdId,recordId})=>{
      calls.membership++;
      assert.equal(userId,user);
      assert.equal(householdId,hh);
      assert.equal(recordId,item);
      return allowed;
    },
    readObject:async({householdId,recordId,fileId})=>{
      calls.storage++;
      assert.deepEqual({householdId,recordId,fileId},{householdId:hh,recordId:item,fileId:file});
      return jpeg;
    },
    ...changes,
  };
  return {gate,calls,revoke:()=>{allowed=false}};
}

test('gateway adapter: allowed read is POST-only, no-store, without a Storage URL',async()=>{
  const {createPhotoReadHandler}=await implementation;
  const f=fixture();
  const handle=createPhotoReadHandler(f.gate);
  const res=await handle(request);
  assert.equal(res.status,200);
  assert.deepEqual(Array.from(res.body),Array.from(jpeg));
  assert.equal(res.headers['Cache-Control'],'private, no-store, max-age=0');
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.equal(JSON.stringify(res).includes('/storage/v1/object/'),false);
  assert.deepEqual(f.calls,{auth:2,membership:2,storage:1});
});

test('gateway adapter: malformed methods and credentials never reach Storage',async()=>{
  const {createPhotoReadHandler}=await implementation;
  const f=fixture();const handle=createPhotoReadHandler(f.gate);
  assert.equal((await handle({...request,method:'GET'})).status,405);
  assert.equal((await handle({...request,authorization:'not bearer'})).status,401);
  assert.equal((await handle({...request,path:hh+'/../'+file+'.jpg'})).status,400);
  assert.equal(f.calls.storage,0);
});

test('gateway adapter: denied membership is rechecked on every POST',async()=>{
  const {createPhotoReadHandler}=await implementation;
  const f=fixture();const handle=createPhotoReadHandler(f.gate);
  assert.equal((await handle(request)).status,200);
  f.revoke();
  const denied=await handle(request);
  assert.equal(denied.status,403);
  assert.equal(denied.body,undefined);
  assert.equal(f.calls.storage,1);
  assert.equal(denied.headers['Cache-Control'],'private, no-store, max-age=0');
});

test('gateway adapter: removal DURING Storage read denies response',async()=>{
  const {createPhotoReadHandler}=await implementation;
  const f=fixture();
  f.gate.readObject=async()=>{f.calls.storage++;f.revoke();return jpeg};
  const handle=createPhotoReadHandler(f.gate);
  const denied=await handle(request);
  assert.equal(denied.status,403);
  assert.equal(denied.body,undefined);
  assert.equal(f.calls.auth,2);
  assert.equal(f.calls.membership,2);
});

test('gateway adapter: upstream errors and invalid JPEG never return object bytes',async()=>{
  const {createPhotoReadHandler}=await implementation;
  for(const changes of [
    {verifySession:async()=>{throw Error('auth timeout')}},
    {checkCurrentAccess:async()=>{throw Error('DB timeout')}},
    {readObject:async()=>{throw Error('Storage down')}},
  ]){
    const f=fixture(changes);
    const denied=await createPhotoReadHandler(f.gate)(request);
    assert.equal(denied.status,503);
    assert.equal(denied.body,undefined);
  }
  for(const invalid of [null,new Uint8Array(0),new Uint8Array(81921),Uint8Array.from([1,2,3,4])]){
    const f=fixture({readObject:async()=>invalid});
    const denied=await createPhotoReadHandler(f.gate)(request);
    assert.equal(denied.status,502);
    assert.equal(denied.body,undefined);
  }
});

test('gateway adapter: refuse missing injected security dependencies',async()=>{
  const {createPhotoReadHandler}=await implementation;
  assert.throws(()=>createPhotoReadHandler(),TypeError);
  assert.throws(()=>createPhotoReadHandler({verifySession:async()=>null}),TypeError);
});
