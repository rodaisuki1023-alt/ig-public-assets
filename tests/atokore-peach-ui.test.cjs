const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../atokore-live-v125/atokore-redesign.js');
const dir=path.resolve(__dirname,'../atokore-live-v125');
test('all five primary diaper brands are recognized separately',()=>{
 const names=[['パンパース','Pampers'],['グーン','GOO.N'],['マミーポコ','MamyPoko'],['ムーニー','moony'],['メリーズ','Merries']];
 for(const [jp,en] of names){const result=ui.describe({name:jp+' さらさら おむつ パンツ M 60枚',cat:'ベビー'});assert.equal(result.brand.en,en);}
});
test('SKU type and size appear but changing pack count is not featured in cards',()=>{
 const x=ui.describe({name:'パンパース さらさらケア おむつ パンツ M 60枚',cat:'ベビー'});
 assert.equal(x.type,'パンツ');assert.equal(x.size,'M');assert.equal(x.line,'さらさらケア');
 const y=ui.describe({name:'マミーポコ 夜用パンツ ビッグ 48枚',cat:'ベビー'});
 assert.equal(y.brand.en,'MamyPoko');assert.equal(y.size,'ビッグ');
 assert.doesNotMatch(x.line,/60枚/);assert.doesNotMatch(y.line,/48枚/);
});
test('legacy generic item is preserved, no brand guessing and HTML is escaped',()=>{
 const x=ui.describe({name:'オムツ',cat:'ベビー'});assert.equal(x.brand,null);
 assert.equal(ui.esc('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
 assert.equal(ui.low({qty:1}),true);assert.equal(ui.low({qty:3}),false);
});
test('integrations stay on the existing storage and action layer',()=>{
 const index=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 const script=fs.readFileSync(path.join(dir,'atokore-redesign.js'),'utf8');
 const css=fs.readFileSync(path.join(dir,'atokore-theme.css'),'utf8');
 const worker=fs.readFileSync(path.join(dir,'service-worker.js'),'utf8');
 assert.match(index,/atokore-theme\.css\?v=13/);assert.match(index,/atokore-redesign\.js\?v=45/);
 assert.match(worker,/\.\/atokore-theme\.css/);assert.match(worker,/\.\/atokore-redesign\.js/);
 assert.match(script,/root\.registerItem\(\)/);
 assert.match(script,/root\.showPremium\('receipt'\)/);
 assert.doesNotMatch(script,/localStorage\.setItem|fetch\(|affiliateUrl|http:\/\/|https:\/\//);
 assert.match(css,/#FAF6F3/);assert.match(css,/#F2DDD6/);
});

test('v50 formal product hides low-quality receipt OCR while retaining explicit QA-only opt-in',()=>{
 const index=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 const fallback=fs.readFileSync(path.join(dir,'atokore-redesign.js'),'utf8');
 const home=fs.readFileSync(path.join(dir,'home-v43.js'),'utf8');
 const receipt=fs.readFileSync(path.join(dir,'receipt.js'),'utf8');
 assert.match(index,/window\.ATOKORE_RECEIPT_EXPERIMENTAL=window\.ATOKORE_RECEIPT_EXPERIMENTAL===true/);
 assert.doesNotMatch(index,/<button onclick="showPremium\('receipt'\)">/);
 assert.match(index,/data-atk-experimental-receipt hidden/);
 assert.match(index,/if\(k==='receipt'&&window\.ATOKORE_RECEIPT_EXPERIMENTAL!==true\)return/);
 assert.match(index,/function applyReceipt\(\)\{if\(window\.ATOKORE_RECEIPT_EXPERIMENTAL!==true\)return/);
 assert.match(home,/root\.ATOKORE_RECEIPT_EXPERIMENTAL===true\?/);
 assert.match(home,/data-atk-buy/);
 assert.match(fallback,/root\.ATOKORE_RECEIPT_EXPERIMENTAL===true\?/);
 assert.match(receipt,/if\(window\.ATOKORE_RECEIPT_EXPERIMENTAL===false\)return/);
});
