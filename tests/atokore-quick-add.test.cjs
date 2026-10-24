const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../atokore-live-v125');
const quick=require('../atokore-live-v125/quick-add.js');
test('shared food and household groups recognize purpose before ingredients without changing stock identity',()=>{
 for(const [name,cat,group] of [
  ['鶏むね肉','食料品','meat'],['卵','食料品','egg'],['玉ねぎ','食料品','vegetable'],['鮭','食料品','fish'],
  ['冷凍ブロッコリー','食料品','frozen'],['牛乳','食料品','milk'],['離乳食 鶏肉と野菜のおかゆ','食料品','babyfood'],
  ['和光堂 栄養マルシェ 白身魚と野菜','食料品','babyfood'],['ベビーフード りんご','食料品','babyfood'],
  ['ティッシュ','日用品','paper'],['キッチンペーパー','日用品','paper'],['柔軟剤','日用品','laundry'],
  ['食器用洗剤','日用品','kitchen'],['離乳食用スプーン','日用品','kitchen'],['浴室洗剤','日用品','cleaning'],
  ['シャンプー','日用品','care'],['自分で登録した道具','日用品','other']
 ])assert.equal(quick.subgroupOf(name,cat),group,name);
 assert.equal(quick.isBabyFood('離乳食用スプーン'),false);assert.equal(quick.isBabyFood('離乳食の保存容器'),false);
 assert.equal(quick.groupsFor('食料品').includes('babyfood'),false,'baby food now has its own category');
 assert.equal(quick.groupLabel('babyfood'),'離乳食');
 const input=[{id:1,name:'離乳食 鶏と野菜 5か月',cat:'食料品',unit:'パック',qty:2}];
 const next=quick.buildBatch(input,[{name:'離乳食 鶏と野菜 7か月',cat:'食料品',unit:'パック',qty:1}]);
 assert.equal(next.length,2);assert.equal(input[0].qty,2);assert.equal(next[0].qty,2);
});
function browser(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/atokore/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['common-v45.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-food-catalog-v35.js','quick-add.js']){
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
 assert.ok($('qaPanel'));assert.equal($('qaSwitchDetails'),null,'advanced entry should not be shown');
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');click('[data-qa-pick="卵"]');click('[data-qa-pick="牛乳"]');click('[data-qa-pick="玉ねぎ"]');
 assert.match($('qaTotal').textContent,/3商品/);
 click('[data-qa-pick="卵"]');
 assert.match($('qaTotal').textContent,/4点/);
 click('[data-qa-review]');click('[data-qa-commit]');
 const data=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(data.items.find(x=>x.name==='卵'&&x.qty===2));
 assert.ok(data.items.find(x=>x.name==='牛乳'));
 assert.ok(data.items.find(x=>x.name==='玉ねぎ'));
 assert.equal($('qaTray').hidden,true);
 assert.match($('stockList').innerHTML,/qa-picture-badge/);
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');click('[data-qa-pick="卵"]');click('[data-qa-review]');click('[data-qa-commit]');
 const newer=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const eggs=newer.items.filter(x=>x.name==='卵');
 assert.equal(eggs.length,2,'an existing expiring egg lot must remain separate');
 assert.ok(eggs.some(x=>x.exp&&x.qty===6),'existing dated stock must not be modified');
 assert.ok(eggs.some(x=>!x.exp&&x.qty===3),'repeated undated quick additions should combine');
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
 assert.match($('qaTotal').textContent,/2商品/);
 click('[data-qa-review]');click('[data-qa-commit]');
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const found=saved.items.filter(x=>x.name.includes('マミーポコ'));
 assert.equal(found.length,2);
 assert.ok(found.some(x=>/M$/.test(x.name)));assert.ok(found.some(x=>/L$/.test(x.name)));
 assert.match($('stockList').textContent,/MamyPoko/);
 dom.window.close();
});
test('advanced registration is replaced by later stock editing',()=>{
 const {w,$,dom}=browser();w.atkOpenAdd();
 assert.equal($('qaSwitchDetails'),null);assert.ok($('qaPanel').textContent.includes('かんたん登録'));
 assert.equal($('pg-add').classList.contains('qa-details-mode'),false);dom.window.close();
});
test('PWA manifest, shell and legacy storage keep existing functionality',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
 assert.match(html,/quick-add\.js\?v=44/);assert.match(html,/quick-add\.css\?v=27/);
 assert.match(sw,/\.\/quick-add.js/);assert.match(sw,/\.\/quick-add.css/);
 assert.match(sw,/atokore-pwa-v45/);
 assert.match(fs.readFileSync(path.join(root,'quick-add.js'),'utf8'),/atokoreTrialV4/);
});


test('show-more reveals additional food choices and selecting does not auto-save',()=>{
 const {w,$,click,dom}=browser();
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');
 assert.equal($('qaTiles').children.length,24);
 assert.equal($('qaMore').hidden,false);
 click('[data-qa-more]');
 assert.ok($('qaTiles').children.length>24,'show more should expand suggestions');
 click('[data-qa-group="meat"]');
 assert.ok($('qaTiles').textContent.includes('鶏むね肉'));
 click('[data-qa-pick="鶏むね肉"]');
 // Choosing shows only the compact bar; the list opens on the review screen.
 assert.equal($('qaBar').hidden,false);assert.equal($('qaTray').hidden,true);click('[data-qa-review]');assert.equal($('qaTray').hidden,false);
 const beforeSave=JSON.parse(w.localStorage.getItem('atokoreTrialV4')||'null');
 assert.ok(!beforeSave||!beforeSave.items.some(x=>x.name==='鶏むね肉'),'tapping tiles must not persist until batch confirmation');
 click('[data-qa-adjust="0"][data-step="1"]');
 assert.match($('qaTotal').textContent,/合計2点/);
 click('[data-qa-review]');click('[data-qa-commit]');
 assert.ok(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.some(x=>x.name==='鶏むね肉'&&x.qty===2));
 dom.window.close();
});
test('food baby-food suggestions and household groups stage selections without saving early',()=>{
 const {w,$,click,dom}=browser();w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');
 const raw=w.localStorage.getItem('atokoreTrialV4');w.AtokoreQuickAdd.setCategory('離乳食');
 click('[data-qa-food-maker="morinaga"]');click('[data-qa-food-product="morinaga-9528"]');click('[data-qa-food-add]');assert.equal(w.localStorage.getItem('atokoreTrialV4'),raw);
 w.AtokoreQuickAdd.setCategory('日用品');click('[data-qa-group="laundry"]');
 assert.ok($('qaTiles').textContent.includes('洗濯洗剤'));assert.ok(!$('qaTiles').textContent.includes('食器用洗剤'));
 click('[data-qa-group="care"]');assert.ok($('qaTiles').textContent.includes('シャンプー'));
 click('[data-qa-review]');click('[data-qa-commit]');const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(saved.items.some(x=>x.name.includes('緑黄色野菜とさつまいも')&&x.cat==='離乳食'&&x.qty===1));
 dom.window.close();
});
test('other-category custom entries remain categorized as other and details are available',()=>{
 const {w,$,click,dom}=browser();
 w.atkOpenAdd();click('[data-qa-cat="その他"]');
 $('qaFree').value='自作の保存用品';
 click('[data-qa-free]');
 click('[data-qa-review]');click('[data-qa-commit]');
 const entry=JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.find(x=>x.name==='自作の保存用品');
 assert.ok(entry);assert.equal(entry.cat,'その他');
 w.atkOpenAdd();assert.equal($('qaSwitchDetails'),null);
 const css=fs.readFileSync(path.join(root,'quick-add.css'),'utf8');
 assert.match(css,/#pg-add\.qa-has-tray/);
 dom.window.close();
});
