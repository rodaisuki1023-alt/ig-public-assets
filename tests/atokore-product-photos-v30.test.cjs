const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
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
 const html=fs.readFileSync('atokore-live-v125/index.html','utf8'),sw=fs.readFileSync('atokore-live-v125/service-worker.js','utf8');
 for(const name of ['product-photos-v30.js','product-photos-v30.css']){assert.ok(html.includes(name));assert.ok(sw.includes("'./"+name+"'"))}
 const js=fs.readFileSync('atokore-live-v125/product-photos-v30.js','utf8');
 assert.ok(js.includes('atokorePreviewProductPhotosV19'));
 assert.doesNotMatch(js,/localStorage\.setItem|fetch\(|XMLHttpRequest|readAsDataURL/);
});
