const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../atokore-live-v125');
const api=require('../atokore-live-v125/product-photos-v30.js');
test('photo identity separates variants, units and records while ignoring quantity',()=>{
 const item={id:1,name:'パンパース パンツ M',unit:'袋',qty:2};
 assert.equal(api.key(item),api.key({...item,qty:3}));
 for(const patch of [{name:'パンパース パンツ L'},{unit:'枚'},{id:2}])assert.notEqual(api.key(item),api.key({...item,...patch}));
});
test('only recognized raster signatures and bounded JPEG output are accepted',()=>{
 assert.equal(api.fileKind(Uint8Array.from([255,216,255,224])),'jpeg');
 assert.equal(api.fileKind(Uint8Array.from([137,80,78,71,13,10,26,10])),'png');
 assert.equal(api.fileKind(Buffer.from('RIFF0000WEBP0000')),'webp');
 assert.equal(api.fileKind(Buffer.from('<svg onload="alert(1)">')),null);
 assert.equal(api.validBlob(new Blob(['123'],{type:'image/svg+xml'})),false);
 assert.equal(api.validBlob(new Blob([new Uint8Array(81921)],{type:'image/jpeg'})),false);
 assert.equal(api.validBlob(new Blob(['123'],{type:'image/jpeg'})),true);
});
test('photo resources are included offline and existing inventory storage remains separate',()=>{
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),sw=fs.readFileSync(path.join(dir,'service-worker.js'),'utf8');
 for(const name of ['product-photos-v30.js','product-photos-v30.css']){assert.ok(html.includes(name));assert.ok(sw.includes("'./"+name+"'"))}
 const js=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 assert.ok(js.includes('atokorePreviewProductPhotosV19'));
 assert.doesNotMatch(js,/localStorage\.setItem|fetch\(|XMLHttpRequest|readAsDataURL/);
});


// Dedicated regression for private family photos: an RLS policy alone is not
// enough if a client starts serving permanent/public or signed/cached URLs.
test('shared photo requests never expose a signed/public URL and recheck the intended scope',()=>{
 const sync=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 const requestStart=sync.indexOf('async function photoRequest(');
 const requestEnd=sync.indexOf('\nasync function fetchPhoto(',requestStart);
 assert(requestStart>=0&&requestEnd>requestStart,'missing private photo transport');
 const transport=sync.slice(requestStart,requestEnd);
 assert.match(transport,/\/functions\/v1\/atokore-photo-gateway/);
 assert.match(transport,/Authorization:'Bearer '\+session\.access_token/);
 assert.match(transport,/cache:'no-store'/);
 assert.match(transport,/!photoSharingEnabled\(\)/);
 assert.doesNotMatch(transport,/\/storage\/v1\/object\/|createSignedUrl|createSignedUploadUrl|\/object\/public\/|getPublicUrl/);
 const fetchStart=sync.indexOf('async function fetchPhoto(');
 const fetchEnd=sync.indexOf('\nasync function sharePhoto(',fetchStart);
 assert(fetchStart>=0&&fetchEnd>fetchStart);
 const fetchBody=sync.slice(fetchStart,fetchEnd);
 assert.match(fetchBody,/validPhotoPath\(path,scope\)/);
 assert.match(fetchBody,/sameScope\(scope,photoScope\(id\)\)/,
   'membership/household scope must be rechecked after the async request');
 assert.match(fetchBody,/blob\.type!=='image\/jpeg'/);
 assert.match(fetchBody,/blob\.size>81920/);
});

test('v50: family photo revocation limitations are visible before sharing and removal',()=>{
 const photos=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 const household=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 assert.match(photos,/以前に見たり保存した写真・バックアップのコピーは回収できません/);
 assert.match(photos,/相手が取得・保存したコピーは後から回収できません/);
 assert.match(household,/家族から外しても、相手がすでに見たり保存した写真・バックアップのコピーは回収できません/);
 assert.match(household,/相手がすでに見たり保存した写真・バックアップのコピーは消せません/);
 assert.match(household,/相手が保存した写真のコピーは後から回収できません/);
 assert.match(household,/相手に保存された写真は後から回収できません/);
});

test('v50: an in-flight family photo cannot repopulate cache after membership scope is reset',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 const hook='root.AtokoreProductPhotos=api;';
 assert(source.includes(hook));
 const item={id:77,name:'合成のテスト商品',unit:'個',photoPath:'synthetic/record/mock.jpg'};
 let scope={household:'h1',user:'u1',sid:'record'},created=0;
 const revoked=[];
 let signatureStarted,finishSignature;
 const entered=new Promise(resolve=>{signatureStarted=resolve});
 const pendingBytes=new Promise(resolve=>{finishSignature=resolve});
 const blob={type:'image/jpeg',size:4,slice(){signatureStarted();return {arrayBuffer:()=>pendingBytes}}};
 const ctx={items:[item],Uint8Array,URL:{
  createObjectURL(){return 'blob:synthetic-'+(++created)},
  revokeObjectURL(url){revoked.push(url)}
 }};
 ctx.AtokoreHousehold={photoScope(){return scope},fetchPhoto:async()=>blob,homeState:()=>({joined:true}),receiptScope:()=>scope?scope.household+':'+scope.user:null};
 vm.runInNewContext(source.replace(hook,'root.__photoRace={loadFor,resetShared,sharedCache,scopeKey};'+hook),ctx);
 const active=ctx.__photoRace;
 assert.equal(active.scopeKey(),'h1:u1');
 const result=active.loadFor(item);
 await entered;
 scope=null;active.resetShared();
 finishSignature(Uint8Array.from([255,216,255,224]).buffer);
 assert.equal(await result,null);
 assert.equal(created,0,'late photo bytes must never create an object URL for an old member');
 assert.equal(active.sharedCache.size,0,'old household photo must not return to the shared cache');
 assert.deepEqual(revoked,[]);
});

test('v50: family photo cache identity uses real household scope, even without an inventory mapping',()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 const hook='root.AtokoreProductPhotos=api;';
 const ctx={items:[],AtokoreHousehold:{
  homeState:()=>({joined:true}),receiptScope:()=>'h2:u2',photoScope:()=>null
 }};
 vm.runInNewContext(source.replace(hook,'root.__photoRace={scopeKey};'+hook),ctx);
 assert.equal(ctx.__photoRace.scopeKey(),'h2:u2');
});

test('v50: private photo gateway never falls back; shared path comes from the server',()=>{
 const sync=fs.readFileSync(path.join(dir,'household-sync-v37.js'),'utf8');
 const request=sync.slice(sync.indexOf('async function photoRequest('),sync.indexOf('\nasync function fetchPhoto('));
 assert.match(request,/cache:'no-store'/);
 assert.doesNotMatch(request,/\/storage\/v1\/object\/|max-age=3600|max-age=86400|cache:'force-cache'/);
 const upload=sync.slice(sync.indexOf('async function sharePhoto('),sync.indexOf('\nasync function refreshChanges('));
 assert.match(upload,/path=await photoRequest\(path,'POST',blob\)/);
 assert.doesNotMatch(upload,/\|\|path/);
});

test('v50: disabled family photo gateway retains local pictures without any shared request',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 const hook='root.AtokoreProductPhotos=api;';
 const item={id:7,name:'合成商品',unit:'個',photoPath:'old/shared/photo.jpg'};
 let requests=0;
 const ctx={items:[item],AtokoreHousehold:{
  photoSharingEnabled:()=>false,photoScope:()=>({household:'h1',user:'u1',sid:'record'}),
  homeState:()=>({joined:true,state:'synced'}),fetchPhoto:async()=>{requests++;throw Error('not allowed')},
  sharePhoto:async()=>{requests++;throw Error('not allowed')}
 }};
 vm.runInNewContext(source.replace(hook,'root.__photoTest={loadFor,cache,shareWaiting};'+hook),ctx);
 ctx.__photoTest.cache.set(api.key(item),'blob:device-photo');
 assert.equal(await ctx.__photoTest.loadFor(item),'blob:device-photo');
 await ctx.__photoTest.shareWaiting();
 assert.equal(requests,0);
});

test('v50: stale row render cannot overwrite a newer photo, a replaced badge or a removed scope',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(dir,'product-photos-v30.js'),'utf8');
 const hook='root.AtokoreProductPhotos=api;';
 const item={id:1,name:'合成商品',unit:'個',photoPath:'old.jpg'};
 const ctx={items:[item],URL:{revokeObjectURL(){}}};
 vm.runInNewContext(source.replace(hook,'root.__renderTest={beginPhotoRender,resetShared};'+hook),ctx);
 const {beginPhotoRender,resetShared}=ctx.__renderTest,element={isConnected:true};
 const old=beginPhotoRender(element,item);assert.equal(old(),true);
 item.photoPath='new.jpg';assert.equal(old(),false);
 const next=beginPhotoRender(element,item);assert.equal(next(),true);
 const newer=beginPhotoRender(element,item);assert.equal(next(),false);assert.equal(newer(),true);
 element.isConnected=false;assert.equal(newer(),false);
 element.isConnected=true;resetShared();assert.equal(newer(),false);
});
