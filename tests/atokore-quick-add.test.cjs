const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../atokore-live-v125');
const quick=require('../atokore-live-v125/quick-add.js');
function browser(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/atokore/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js','quick-add.js']){
  w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 }
 const $=id=>w.document.getElementById(id);
 return {dom,w,$,click:(selector)=>{const el=w.document.querySelector(selector);assert.ok(el,selector+' must exist');el.click()}};
}
test('distinctly recognizable, original pictograms for meat, eggs, vegetables and paper',()=>{
 const types=[['豚こま肉','meat'],['卵','egg'],['玉ねぎ','vegetable'],['牛乳','milk'],['食パン','bread'],['トイレットペーパー','paper'],['洗濯洗剤','wash']];
 for(const [name,k] of types){assert.equal(quick.kindOf(name),k);const icon=quick.iconFor(name);assert.match(icon,/<svg/);assert.doesNotMatch(icon,/<image|<script|foreignObject/i);}
});
test('batch combines matching generic stock but not mismatched variants, never mutates original',()=>{
 const original=[{id:55,name:'卵',cat:'食料品',qty:1,unit:'パック',exp:'',expType:'期限なし'}];
 const res=quick.buildBatch(original,[
  {name:'卵',cat:'食料品',qty:2,unit:'パック'},
  {name:'卵',cat:'食料品',qty:1,unit:'個'},
  {name:'パンパース おむつ パンツ M',cat:'ベビー',qty:1,unit:'袋'},
  {name:'パンパース おむつ パンツ L',cat:'ベビー',qty:1,unit:'袋'}
 ],55);
 assert.equal(original[0].qty,1);assert.equal(res.find(x=>x.id===55).qty,3);
 assert.equal(res.length,4);assert.equal(new Set(res.map(x=>x.id)).size,4);
 assert.notEqual(res.find(x=>x.name.endsWith(' M')).id,res.find(x=>x.name.endsWith(' L')).id);
 assert.throws(()=>quick.buildBatch([], [{name:'bad',cat:'食料品',qty:0,unit:'個'}]),/数量/);
});
test('select and batch register groceries using real PWA storage and inventory rendering',()=>{
 const {w,$,click,dom}=browser();
 assert.ok($('qaPanel'));assert.equal($('qaSwitchQuick').classList.contains('selected'),true);
 w.atkOpenAdd();click('[data-qa-pick="卵"]');click('[data-qa-pick="牛乳"]');click('[data-qa-pick="玉ねぎ"]');
 assert.match($('qaTotal').textContent,/3種類/);
 click('[data-qa-pick="卵"]');
 assert.match($('qaTotal').textContent,/4点/);
 click('[data-qa-commit]');
 const data=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(data.items.find(x=>x.name==='卵'&&x.qty===2));
 assert.ok(data.items.find(x=>x.name==='牛乳'));
 assert.ok(data.items.find(x=>x.name==='玉ねぎ'));
 assert.equal($('qaTray').hidden,true);
 assert.match($('stockList').innerHTML,/qa-picture-badge/);
 w.atkOpenAdd();click('[data-qa-pick="卵"]');click('[data-qa-commit]');
 const newer=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 console.log('DEBUG_EGG_RECORDS',JSON.stringify(newer.items.filter(x=>x.name==='卵')));
 assert.equal(newer.items.filter(x=>x.name==='卵').length,1);
 assert.equal(newer.items.find(x=>x.name==='卵').qty,3);
 assert.ok(newer.buys&&Array.isArray(newer.buys));
 dom.window.close();
});
test('baby products can be added to the tray by brand/type/size without overwriting another size',()=>{
 const {w,$,click,dom}=browser();
 w.atkOpenAdd();click('[data-qa-cat="ベビー"]');
 click('[data-qa-baby="brand"][data-value="マミーポコ"]');
 click('[data-qa-baby="type"][data-value="パンツ"]');
 click('[data-qa-baby="size"][data-value="M"]');
 click('[data-qa-babyadd]');
 click('[data-qa-baby="size"][data-value="L"]');
 click('[data-qa-babyadd]');
 assert.match($('qaTotal').textContent,/2種類/);
 click('[data-qa-commit]');
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const found=saved.items.filter(x=>x.name.includes('マミーポコ'));
 assert.equal(found.length,2);
 assert.ok(found.some(x=>/M$/.test(x.name)));assert.ok(found.some(x=>/L$/.test(x.name)));
 assert.match($('stockList').textContent,/MamyPoko/);
 dom.window.close();
});
test('full detailed registration remains accessible',()=>{
 const {w,$,click,dom}=browser();
 w.atkOpenAdd();click('[data-qa-view="details"]');
 assert.equal($('pg-add').classList.contains('qa-details-mode'),true);
 assert.equal(typeof w.atkSubmitItem,'function');
 click('[data-qa-view="quick"]');
 assert.equal($('pg-add').classList.contains('qa-details-mode'),false);
 dom.window.close();
});
test('PWA manifest, shell and legacy storage keep existing functionality',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
 assert.match(html,/quick-add\.js\?v=14/);assert.match(html,/quick-add\.css\?v=14/);
 assert.match(sw,/\.\/quick-add.js/);assert.match(sw,/\.\/quick-add.css/);
 assert.match(sw,/atokore-pwa-v14/);
 assert.match(fs.readFileSync(path.join(root,'quick-add.js'),'utf8'),/atokoreTrialV4/);
});
