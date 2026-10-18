const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {identify,svg,esc}=require('../atokore-live-v125/baby-visuals.js');
test('brand and explicit type/size are recognized without making up missing values',()=>{
 const a=identify({name:'パンパース さらさらケア おむつ パンツ M 60枚',cat:'ベビー'});
 assert.equal(a.kind,'diaper');assert.equal(a.brand,'パンパース');assert.equal(a.type,'パンツ');assert.equal(a.size,'M');assert.equal(a.amount,'60枚');
 const b=identify({name:'グーン オムツS',cat:'ベビー'});
 assert.equal(b.brand,'グーン');assert.equal(b.size,'S');assert.equal(b.type,'');
 const unknown=identify({name:'オムツ',cat:'ベビー'});
 assert.equal(unknown.brand,'');assert.equal(unknown.size,'');assert.equal(unknown.type,'');
});
test('milk and wipes are separate originals',()=>{
 const milk=identify({name:'明治 ほほえみ 粉ミルク 缶 800g',cat:'ベビー'});
 assert.equal(milk.kind,'milk');assert.equal(milk.type,'缶');assert.equal(milk.amount,'800g');
 assert.equal(identify({name:'おしりふき',cat:'ベビー'}).kind,'wipes');
 assert.equal(identify({name:'牛乳',cat:'食料品'}),null);
});
test('all SVG pictures are local originals without images, links, logos or scripts',()=>{
 for(const kind of ['diaper','milk','wipes','other']){
  const s=svg(kind);assert.match(s,/^<svg /);assert.match(s,/<path|<rect/);
  assert.doesNotMatch(s,/<image|https?:|<script|パンパース|グーン|ムーニー|メリーズ/i);
 }
 assert.equal(esc('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
});
test('entrypoint and offline PWA shell include visual assets',()=>{
 const base=path.join(__dirname,'..','atokore-live-v125');
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/baby-visuals\.js\?v=bv1/);
 assert.match(sw,/\.\/baby-visuals\.js/);
 assert.ok(html.indexOf('baby-visuals.js')>html.indexOf('stability.js'));
});
