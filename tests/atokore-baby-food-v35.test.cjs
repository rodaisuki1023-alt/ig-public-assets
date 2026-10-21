const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const catalog=require('../atokore-live-v125/baby-food-catalog-v35.js');
const quick=require('../atokore-live-v125/quick-add.js');
const base=path.resolve(__dirname,'../atokore-live-v125');
const KEY='atokoreTrialV4';
function browser(){
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const name of ['data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','baby-food-catalog-v35.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])w.eval(fs.readFileSync(path.join(base,name),'utf8'));
 const $=id=>w.document.getElementById(id),click=s=>{const node=w.document.querySelector(s);assert.ok(node,s);node.click()};
 return {dom,w,$,click};
}
test('audited catalog has complete sourced facts, unique variants, default excludes production-ended records',()=>{
 assert.equal(catalog.reviewedAt,'2026-10-21');assert.equal(catalog.products.length,272);assert.equal(catalog.find().length,203);
 assert.equal(catalog.find({maker:'kewpie'}).length,0);assert.equal(catalog.find({maker:'kewpie',ended:true}).length,69);
 assert.equal(new Set(catalog.products.map(p=>p.id)).size,272);assert.equal(new Set(catalog.products.map(catalog.fullName)).size,272);
 for(const p of catalog.products){assert.ok(p.age&&p.amount&&p.format&&p.series);assert.ok(p.month>=5&&p.month<=16);assert.ok(catalog.fullName(p).length<=120);assert.match(p.source,/^https:\/\/(www\.(wakodo|kewpie|morinagamilk)\.co\.jp|products\.pigeon\.co\.jp)\//);assert.ok(Object.isFrozen(p))}
 const source=fs.readFileSync(path.join(base,'baby-food-catalog-v35.js'),'utf8');assert.doesNotMatch(source,/localStorage|indexedDB|fetch\(/);
 const worker=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');assert.match(worker,/\.\/baby-food-catalog-v35.js/);
});
test('individual ages and package amounts are preserved; range and year labels parse without raising minimum age',()=>{
 assert.equal(catalog.get('kewpie-4901577091513'),undefined);assert.equal(catalog.get('pigeon-2745'),undefined);assert.equal(catalog.get('pigeon-2813').month,5);assert.equal(catalog.get('pigeon-2856').month,7);
 assert.match(catalog.get('pigeon-2120').amount,/480g/);assert.match(catalog.get('pigeon-2120').amount,/80g×2パック×3個/);
 const rice=catalog.find({maker:'wakodo'}).filter(p=>p.series==='お米を味わう離乳食');assert.equal(rice.length,3);assert.ok(rice.every(p=>p.month===6));
 for(const [s,m] of [['5、6ヵ月頃から',5],['7、8ヵ月頃から',7],['9～11か月頃から',9],['1歳4か月頃から',16],['1歳半頃から',18],['1才6ヵ月頃',18],['12か月頃',12]])assert.equal(catalog.monthOf(s),m,s);
 assert.equal(catalog.monthOf('野菜ペースト 80g'),null);assert.equal(catalog.isRecord({cat:'日用品',name:'離乳食用スプーン'}),false);
 assert.equal(catalog.makerOf('WAKODO 離乳食'), 'wakodo');assert.equal(catalog.makerOf('キューピー 離乳食'),'kewpie');
});
test('presets count one retail product once and never combine different manufacturer, age or pack variants',()=>{
 const a=catalog.line('wakodo-63018533',2),b=catalog.line('pigeon-2120',1),c=catalog.line('morinaga-9528',1);
 assert.match(a.name,/80g×2パック/);assert.equal(a.qty,2);assert.equal(b.qty,1);assert.equal(b.unit,'個');
 const next=quick.buildBatch([], [a,b,c]);assert.equal(next.length,3);assert.deepEqual(next.map(x=>x.qty),[2,1,1]);
 const after=quick.buildBatch(next,[a,{...a,name:a.name.replace('80g×2パック','80g×1パック')}]);assert.equal(after.length,4);assert.equal(after[0].qty,4);assert.equal(next[0].qty,2);
 assert.throws(()=>catalog.line('missing'),/商品/);assert.throws(()=>catalog.line('pigeon-2120',0),/数量/);
});
test('independent stock category includes legacy records without rewriting any inventory and clears hidden selections',()=>{
 const {dom,w,$,click}=browser();
 const all=[{id:1,name:'和光堂 離乳食 おかゆ 7か月',cat:'食料品',qty:2,unit:'パック'},{id:2,name:'手作り 離乳食 野菜',cat:'ベビー',qty:1,unit:'個'},{id:3,...catalog.line('morinaga-9528',2)},{id:4,name:'玉ねぎ',cat:'食料品',qty:2,unit:'個'}];
 w.eval('items='+JSON.stringify(all)+';buys=[];save();render()');const raw=w.localStorage.getItem(KEY);
 const ids=()=>Array.from($('stockList').querySelectorAll('[data-stock-id]'),x=>Number(x.dataset.stockId));
 w.setFilter('食料品');assert.deepEqual(ids(),[4]);w.setFilter('離乳食');assert.deepEqual(ids(),[1,2,3]);
 click('[data-bf-stock-kind="wakodo"]');assert.deepEqual(ids(),[1]);w.toggleStockSelect();w.selectAllVisible();assert.match($('stockBulkMove').textContent,/1件/);
 click('[data-bf-stock-kind="other"]');assert.match($('stockBulkMove').textContent,/0件/);assert.deepEqual(ids(),[2]);
 w.selectAllVisible();w.moveSelectedToBuy();const saved=JSON.parse(w.localStorage.getItem(KEY));assert.deepEqual(saved.items,all);assert.deepEqual(saved.buys.map(x=>x.name),[all[1].name]);
 assert.equal(JSON.parse(raw).items[0].cat,'食料品');assert.equal(JSON.parse(raw).items[1].cat,'ベビー');dom.window.close();
});
test('manufacturer, series and age selection requires an explicit product, stages first and preserves new category after editing',()=>{
 const {dom,w,$,click}=browser();w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('離乳食');const raw=w.localStorage.getItem(KEY);
 click('[data-qa-food-maker="pigeon"]');click('[data-qa-food-add]');assert.equal(w.AtokoreQuickAdd.getTray().length,0);
 $('qaFoodSeriesSelect').value='カップシリーズ';$('qaFoodSeriesSelect').dispatchEvent(new w.Event('change',{bubbles:true}));
 click('[data-qa-food-product="pigeon-2813"]');assert.equal($('qaBabyFood').querySelectorAll('[data-qa-food-product]').length,1);
 click('[data-qa-food-step="1"]');click('[data-qa-food-add]');assert.equal(w.localStorage.getItem(KEY),raw);
 click('[data-qa-commit]');const data=JSON.parse(w.localStorage.getItem(KEY));const item=data.items.find(x=>x.name===catalog.fullName(catalog.get('pigeon-2813')));assert.ok(item);assert.equal(item.qty,2);assert.equal(item.cat,'離乳食');
 w.AtokoreEditAfterAdd?.open?.(item.id);
 const editor=require('../atokore-live-v125/edit-after-add.js');assert.equal(editor.validate({...item,name:item.name+' メモ',expType:'期限なし'},item).cat,'離乳食');dom.window.close();
});
test('production-ended items are explicit; custom maker fields survive quantity changes and are escaped',()=>{
 const {dom,w,$,click}=browser();w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('離乳食');
 assert.ok(!$('qaBabyFood').querySelector('[data-qa-food-maker="kewpie"]').closest('details').open);
 click('[data-qa-food-maker="kewpie"]');assert.match($('qaBabyFood').textContent,/2026年8月末/);assert.ok($('qaBabyFood').querySelectorAll('[data-qa-food-product]').length>0);
 click('[data-qa-food-maker="other"]');
 for(const [field,value] of [['Brand','手作り<img>'],['Name','野菜<svg>'],['Age','7か月頃'],['Amount','30g'],['Format','冷凍']]){$('qaFood'+field).value=value;$('qaFood'+field).dispatchEvent(new w.Event('input',{bubbles:true}))}
 click('[data-qa-food-step="1"]');assert.equal($('qaFoodBrand').value,'手作り<img>');assert.equal($('qaFoodAmount').value,'30g');
 click('[data-qa-food-add]');assert.equal(w.AtokoreQuickAdd.getTray()[0].qty,2);assert.equal($('qaTrayList').querySelector('img'),null);assert.ok($('qaTrayList').textContent.includes('手作り<img>'));dom.window.close();
});
test('failed storage retains the infant-food tray and retries exactly once without losing legacy data',()=>{
 const {dom,w,click}=browser();w.eval('save()');const raw=w.localStorage.getItem(KEY);
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('離乳食');click('[data-qa-food-maker="morinaga"]');click('[data-qa-food-product="morinaga-9923"]');click('[data-qa-food-add]');
 const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key===KEY)throw Error('quota');return set.call(this,key,value)};
 click('[data-qa-commit]');assert.equal(w.localStorage.getItem(KEY),raw);assert.equal(w.AtokoreQuickAdd.getTray().length,1);
 w.Storage.prototype.setItem=set;click('[data-qa-commit]');click('[data-qa-commit]');
 const after=JSON.parse(w.localStorage.getItem(KEY));assert.equal(after.items.filter(x=>x.name===catalog.fullName(catalog.get('morinaga-9923'))).length,1);assert.equal(w.AtokoreQuickAdd.getTray().length,0);dom.window.close();
});
