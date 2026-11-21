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
 assert.match(transport,/root\.fetch\(base\+'\/storage\/v1\/object\/'/);
 assert.match(transport,/method==='GET'\?'authenticated\/':'/);
 assert.match(transport,/Authorization:'Bearer '\+session\.access_token/);
 assert.match(transport,/cache:'no-store'/);
 assert.match(transport,/'cache-control':'no-cache'/);
 assert.match(transport,/\?v='\+/,'fresh authenticated GETs require a changing query token');
 assert.match(transport,/root\.crypto\?\.randomUUID\?\.\(\)/,'prefer a unique per-request nonce instead of a time-only value');
 assert.match(transport,/Date\.now\(\)/,'old Safari retains a nonce fallback');
 assert.doesNotMatch(transport,/createSignedUrl|createSignedUploadUrl|\/object\/public\/|getPublicUrl/);
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
