const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../atokore-live-v125/household-sync-v37.js'),'utf8');
const start=source.indexOf('function photoSharingEnabled('),end=source.indexOf('\nasync function fetchPhoto(',start);
assert.ok(start>=0&&end>start);
const fragment=source.slice(start,end);
const jpeg=Uint8Array.from([255,216,255,224,23,12,255,217]);
function setup(status=200,returnedPath,enabled=true) {
 const calls=[], now='https://synthetic.invalid',picture='12345678-1234-1234-1234-123456789abc/mockRecord/12345678-1234-1234-1234-123456789abc.jpg';
 const ctx={
  session:{access_token:'synthetic-jwt',expires_at:9999999999},
  cfg:{anonKey:'sb_publishable_synthetic',photoGatewayEnabled:enabled},
  base:now,Uint8Array,AbortController,
  root:{
   AbortController,
   btoa:x=>Buffer.from(x,'binary').toString('base64'),
   crypto:{randomUUID:()=> 'random-synthetic'},
   fetch:async(url,opts)=>{
    calls.push({url,opts});
    if(status!==200)return {ok:false,status};
    return {ok:true,blob:async()=>({type:'image/jpeg',size:8}),json:async()=>({path:returnedPath===undefined?picture:returnedPath})};
   }
  },
  setTimeout:()=>1,clearTimeout:()=>{},refreshSession:()=>{throw Error('unexpected refresh')},
  Date
 };
 vm.runInNewContext(fragment+'\nglobalThis.photoRequest=photoRequest;',ctx);
 return {ctx,calls,picture,photoRequest:ctx.photoRequest};
}
test('photo gateway read uses ONLY protected POST; client does not reuse Storage URL',async()=>{
 const t=setup();
 const received=await t.photoRequest(t.picture,'GET');
 assert.equal(received.type,'image/jpeg');
 assert.equal(t.calls.length,1);
 const c=t.calls[0];
 assert.equal(c.url,'https://synthetic.invalid/functions/v1/atokore-photo-gateway');
 assert.equal(c.opts.method,'POST');assert.equal(c.opts.cache,'no-store');
 assert.equal(c.opts.headers.Authorization,'Bearer synthetic-jwt');
 const payload=JSON.parse(c.opts.body);
 assert.equal(payload.operation,'read');assert.equal(payload.path,t.picture);
 assert.equal(c.url.includes('/storage/v1/object/'),false);
});
test('photo gateway upload returns SERVER path and sends only validated JPEG',async()=>{
 const t=setup();
 const blob={type:'image/jpeg',size:jpeg.length,arrayBuffer:async()=>jpeg.buffer};
 const result=await t.photoRequest(t.picture,'POST',blob);
 assert.equal(result,t.picture);
 const payload=JSON.parse(t.calls[0].opts.body);
 assert.equal(payload.operation,'write');
 assert.equal(payload.base64,Buffer.from(jpeg).toString('base64'));
 assert.equal(payload.householdId,t.picture.split('/')[0]);
 assert.equal(payload.recordId,t.picture.split('/')[1]);
 assert.equal(Object.keys(payload).includes('path'),false);
});
test('gateway error refuses photo and NEVER falls back to legacy Storage',async()=>{
 const t=setup(403);
 await assert.rejects(t.photoRequest(t.picture,'GET'),/許可/);
 assert.equal(t.calls.length,1);
 assert.ok(!t.calls[0].url.includes('/storage/v1/object/'));
});

test('photo upload cannot link another household, item or malformed UUID from gateway response',async()=>{
 const blob={type:'image/jpeg',size:jpeg.length,arrayBuffer:async()=>jpeg.buffer};
 const original=setup().picture;
 for(const foreign of [
  original.replace('12345678-1234-1234-1234-123456789abc/','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/'),
  original.replace('/mockRecord/','/otherItem/'),
  original.replace(/\/[^/]+\.jpg$/,'/------------------------------------.jpg'),
  original+'?signed=unexpected',original+'\n',null
 ]){
  const t=setup(200,foreign);
  await assert.rejects(t.photoRequest(t.picture,'POST',blob),/保存先/);
  assert.equal(t.calls.length,1);
 }
});

test('disabled gateway: read and write are rejected before any HTTP or refresh',async()=>{
 const t=setup(200,undefined,false);
 await assert.rejects(t.photoRequest(t.picture,'GET'),/停止中/);
 await assert.rejects(t.photoRequest(t.picture,'POST',{type:'image/jpeg',size:8}),/停止中/);
 assert.equal(t.calls.length,0);
});
test('malformed path cannot reach HTTP',async()=>{
 const t=setup();
 await assert.rejects(t.photoRequest(t.picture+'\n','GET'),/保存先/);
 assert.equal(t.calls.length,0);
});
