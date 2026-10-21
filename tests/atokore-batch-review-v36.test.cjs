// v36: pending products are saved only from the review screen, a failed save keeps them,
// a drawing error after a confirmed save is never reported as a failed save, and the stock list
// shows the saved records even when an earlier filter or search word would hide them.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
const KEY='atokoreTrialV4';
const seed={items:[
 {id:1,name:'牛乳',cat:'食料品',qty:1,unit:'本',place:'冷蔵庫',expType:'消費期限',exp:'2099-01-01',usage:1},
 {id:2,name:'パンパース さらさらケア おむつ テープ M',cat:'ベビー',qty:2,unit:'袋',place:'収納',expType:'期限なし',exp:'',usage:1},
 {id:3,name:'卵',cat:'食料品',qty:6,unit:'個',place:'冷蔵庫',usage:1}
],buys:[{id:10,name:'おしりふき詰替',qty:1,unit:'パック'}],routines:[{id:901,name:'ベビー定番',items:[]}]};
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/atokore/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};
 w.localStorage.setItem(KEY,JSON.stringify(seed));
 w.eval('items=JSON.parse(localStorage.getItem("'+KEY+'")).items;buys=JSON.parse(localStorage.getItem("'+KEY+'")).buys;routines=JSON.parse(localStorage.getItem("'+KEY+'")).routines;');
 for(const file of ['data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','baby-food-catalog-v35.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 const $=id=>w.document.getElementById(id);
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector+' must exist');el.click()};
 return {dom,w,$,click};
}
const stored=w=>JSON.parse(w.localStorage.getItem(KEY));
const memory=w=>JSON.parse(w.eval('JSON.stringify({items,buys,routines})'));
const visible=w=>[...w.document.querySelectorAll('#stockList [data-stock-id]')].map(e=>Number(e.dataset.stockId));
function pickThree(w,click){
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('ベビー');
 for(const [field,value] of [['kind','diaper'],['brand','パンパース'],['type','パンツ'],['size','ビッグ']])click(`[data-qa-baby="${field}"][data-value="${value}"]`);
 click('[data-qa-babyadd]');
 for(const [field,value] of [['kind','milk'],['brand','明治'],['type','缶']])click(`[data-qa-baby="${field}"][data-value="${value}"]`);
 click('[data-qa-babyadd]');
 for(const [field,value] of [['kind','wipes'],['brand','Rico']])click(`[data-qa-baby="${field}"][data-value="${value}"]`);
 click('[data-qa-babyadd]');
}

test('choosing shows a compact bar; opening, going back and leaving the review never save',()=>{
 const {dom,w,$,click}=browser(),raw=w.localStorage.getItem(KEY);
 assert.equal($('qaBar').hidden,true,'no bar while nothing is pending');
 pickThree(w,click);
 assert.equal($('qaBar').hidden,false);assert.equal($('qaTray').hidden,true);
 assert.match($('qaBar').textContent,/追加した商品を確認する/);assert.match($('qaBar').textContent,/3商品・合計3点/);
 $('qaCommit').click();
 assert.equal(w.localStorage.getItem(KEY),raw,'the final button does nothing until the list is shown');
 click('[data-qa-review]');
 assert.equal($('qaTray').hidden,false);assert.equal($('pg-add').classList.contains('qa-reviewing'),true);
 assert.equal($('qaTrayList').querySelectorAll('.qa-review-item').length,3);
 assert.match($('qaTotal').textContent,/3商品（数量の合計3点）/);
 assert.match($('qaTrayDest').textContent,/保存先：ストック/);
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 assert.match($('qaTrayList').textContent,/パンパース さらさらケア おむつ パンツ ビッグ|パンパース おむつ パンツ ビッグ/);
 assert.match($('qaTrayList').textContent,/新しい商品として登録/);
 click('[data-qa-review-back]');
 assert.equal($('qaTray').hidden,true);assert.equal($('qaBar').hidden,false);
 click('[data-qa-review]');w.go('home');
 assert.equal(w.AtokoreQuickAdd.isReviewing(),false);assert.equal(w.AtokoreQuickAdd.getTray().length,3,'leaving keeps the pending list');
 assert.equal(w.localStorage.getItem(KEY),raw);assert.deepEqual(memory(w),seed);
 dom.window.close();
});

test('review edits quantities and removes lines; minus never deletes; merge and new are told apart',()=>{
 const {dom,w,$,click}=browser();
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('ベビー');
 for(const [field,value] of [['kind','diaper'],['brand','パンパース'],['type','テープ'],['size','M'],['series','さらさらケア']])click(`[data-qa-baby="${field}"][data-value="${value}"]`);
 click('[data-qa-babyadd]');
 for(const [field,value] of [['kind','wipes'],['brand','Rico']])click(`[data-qa-baby="${field}"][data-value="${value}"]`);
 click('[data-qa-babyadd]');
 click('[data-qa-review]');
 const rows=()=>[...$('qaTrayList').querySelectorAll('.qa-review-item')];
 assert.match(rows()[0].textContent,/登録済みの在庫に合算：2袋 → 3袋/);
 assert.match(rows()[1].textContent,/新しい商品として登録/);
 const minus=rows()[0].querySelector('[data-step="-1"]');assert.equal(minus.disabled,true);minus.click();
 assert.equal(w.AtokoreQuickAdd.getTray().length,2,'minus at 1 does not delete');
 rows()[0].querySelector('[data-step="1"]').click();rows()[0].querySelector('[data-step="1"]').click();
 assert.match(rows()[0].textContent,/2袋 → 5袋/);
 rows()[1].querySelector('[data-qa-remove]').click();
 assert.equal(rows().length,1);assert.match($('qaTotal').textContent,/1商品（数量の合計3点）/);
 click('[data-qa-review-back]');click('[data-qa-review]');
 assert.equal(w.AtokoreQuickAdd.getTray()[0].qty,3,'going back and reopening keeps the edits');
 // Destination is shown and switchable on the review screen; the effect follows it.
 $('qaTray').querySelector('[data-qa-dest="buy"]').click();
 assert.equal($('qaCommit').textContent,'まとめて買い物リストに追加');assert.match($('qaTrayDest').textContent,/買い物リスト/);
 assert.match(rows()[0].textContent,/買い物リストに新しく追加/);
 click('[data-qa-commit]');
 const after=stored(w);
 assert.deepEqual(after.items,seed.items,'stock untouched when saving to the shopping list');
 assert.equal(after.buys.find(x=>x.name==='パンパース さらさらケア おむつ テープ M').qty,3);
 dom.window.close();
});

test('a failed save keeps the review open with the same lines and leaves data and memory unchanged',()=>{
 const {dom,w,$,click}=browser(),raw=w.localStorage.getItem(KEY);
 pickThree(w,click);click('[data-qa-review]');
 const original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(k,v){if(k===KEY)throw new w.DOMException('full','QuotaExceededError');return original.call(this,k,v)};
 try{click('[data-qa-commit]')}finally{w.Storage.prototype.setItem=original}
 assert.equal(w.localStorage.getItem(KEY),raw);assert.deepEqual(memory(w),seed);
 assert.equal(w.AtokoreQuickAdd.getTray().length,3);assert.equal(w.AtokoreQuickAdd.isReviewing(),true);
 assert.match($('qaNotice').textContent,/保存できませんでした。追加予定はそのまま残っています/);
 assert.equal($('qaCommit').disabled,false,'can retry');
 click('[data-qa-commit]');click('[data-qa-commit]');
 const after=stored(w);
 assert.equal(after.items.length,seed.items.length+3,'retry saves each product exactly once');
 dom.window.close();
});

test('a drawing error after a confirmed save is not reported as a failure and cannot add twice',()=>{
 const {dom,w,$,click}=browser();
 pickThree(w,click);click('[data-qa-review]');
 const errors=[];w.console.error=(...a)=>errors.push(a.join(' '));
 w.render=()=>{throw Error('injected render failure')};
 click('[data-qa-commit]');
 const after=stored(w);
 assert.equal(after.items.length,seed.items.length+3,'saved');
 assert.deepEqual(memory(w).items,after.items,'memory matches what was stored');
 assert.equal(w.AtokoreQuickAdd.getTray().length,0);
 assert.doesNotMatch($('qaNotice').textContent,/保存できませんでした|残っています/);
 assert.match($('qaNotice').textContent,/保存しました.*もう一度追加する必要はありません/);
 assert.ok(errors.some(e=>/保存後の表示更新に失敗/.test(e)));
 click('[data-qa-review]');click('[data-qa-commit]');
 assert.equal(stored(w).items.length,seed.items.length+3,'a second tap adds nothing');
 dom.window.close();
});

test('after saving, a leftover category, subgroup or search word no longer hides the new records',()=>{
 for(const prepare of [
  w=>{w.go('stock');w.setFilter('離乳食')},
  w=>{w.go('stock');w.setFilter('食料品')},
  w=>{w.go('stock');w.setFilter('ベビー');w.document.querySelector('[data-bf-stock-kind="diaper"]').click()},
  w=>{w.go('stock');w.document.getElementById('stockSearch').value='卵';w.renderStock()},
 ]){
  const {dom,w,$,click}=browser();
  prepare(w);pickThree(w,click);click('[data-qa-review]');click('[data-qa-commit]');
  const added=stored(w).items.slice(seed.items.length).map(x=>x.id);
  assert.equal(added.length,3);
  assert.equal($('pg-stock').classList.contains('on'),true);
  for(const id of added)assert.ok(visible(w).includes(id),'record '+id+' is shown');
  assert.equal($('stockSearch').value,'');assert.equal(w.eval('filter'),'ベビー');
  assert.equal(w.document.querySelectorAll('#stockList .bf-stock-added').length,3);
  dom.window.close();
 }
});

test('the same reveal applies after adding a recurring list straight to stock',()=>{
 const {dom,w,$}=browser();
 w.eval("routines[0].items=[{id:1,name:'Rico おしりふき',qty:2,unit:'パック'}];localStorage.setItem('"+KEY+"',JSON.stringify({items,buys,routines}))");
 w.go('stock');w.setFilter('食料品');
 assert.equal(w.AtokoreBabyFlow.addRoutineToStock(901),true);
 const added=stored(w).items.find(x=>x.name==='Rico おしりふき');
 assert.ok(added);assert.ok(visible(w).includes(added.id));
 dom.window.close();
});
