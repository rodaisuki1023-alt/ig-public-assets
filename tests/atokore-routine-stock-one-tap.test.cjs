const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;const alerts=[],confirms=[];
 w.alert=msg=>alerts.push(msg);
 w.confirm=msg=>{confirms.push(msg);return true};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['common-v45.js','data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 return {dom,w,alerts,confirms,$:id=>w.document.getElementById(id)};
}
function setup(w,$,id=801,entries=[{id:11,name:'パンパース おむつ パンツ M',qty:2,unit:'袋'},{id:12,name:'卵',qty:1,unit:'パック'}]){
 w.eval('routines.push('+JSON.stringify({id,name:'いつものやつ',items:entries})+');renderRoutines();save()');
 w.go('buy');
 const card=$('routineList').querySelector('[data-bf-routine="'+id+'"]');
 const stock=$('routineList').querySelector('[data-bf-routine-stock="'+id+'"]');
 assert.ok(card);assert.ok(stock);
 return {card,stock};
}
const state=w=>JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
// v47: the confirmation is the app's own dialog (a native confirm() can be suppressed without UI).
const dialog=w=>w.document.getElementById('atkConfirm');
const settle=()=>new Promise(r=>setTimeout(r,0));
async function answer(w,accept){
 const d=dialog(w);assert.ok(d,'the app shows its own confirmation');
 d.querySelector(accept?'.atk-confirm-primary':'button:not(.atk-confirm-primary)').click();await settle();
}

test('tapping the repeat-list card displays its detail and never touches stock or tray',()=>{
 const {dom,w,$,confirms}=browser();
 const {card}=setup(w,$);
 const before=w.localStorage.getItem('atokoreTrialV4');
 card.click();
 assert.equal($('modal').classList.contains('on'),true);
 assert.match($('sheet').textContent,/いつものリスト/);
 assert.match($('sheet').textContent,/パンパース/);
 assert.ok($('atkRoutineStockCommit'),'explicit stock-add button is in the details');
 assert.equal($('pg-buy').classList.contains('on'),true);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'no write for card tap');
 assert.equal(w.AtokoreQuickAdd.getTray().length,0,'no accidental staging');
 assert.equal(confirms.length,0,'viewing needs no confirmation');
 dom.window.close();
});
test('explicit stock button first confirms details, and only acceptance writes stock',async()=>{
 const {dom,w,$,confirms}=browser();const {card}=setup(w,$);
 const before=state(w);
 card.click();
 $('atkRoutineStockCommit').click();
 assert.deepEqual(state(w),before,'nothing is written before the answer');
 assert.match(dialog(w).textContent,/追加してもいいですか/);
 assert.match(dialog(w).textContent,/パンパース/);
 await answer(w,false);
 assert.equal(dialog(w),null);
 assert.deepEqual(state(w),before);
 assert.equal($('modal').classList.contains('on'),true);
 $('atkRoutineStockCommit').click();
 await answer(w,true);
 assert.equal($('pg-stock').classList.contains('on'),true);
 assert.equal($('modal').classList.contains('on'),false);
 const after=state(w);
 assert.deepEqual(after.routines,before.routines);
 assert.deepEqual(after.buys,before.buys);
 assert.ok(after.items.some(x=>x.name==='パンパース おむつ パンツ M'&&x.qty===2));
 assert.ok(after.items.some(x=>x.name==='卵'&&x.unit==='パック'));
 assert.equal(confirms.length,0,'no native dialog');
 assert.match($('stableToastV125h').textContent,/ストックに追加しました/);
 dom.window.close();
});
test('explicit stock action on the card also confirms, then preserves unrelated and dated stock',async()=>{
 const {dom,w,$,confirms}=browser();
 w.eval("items.push({id:889,name:'卵',cat:'食料品',qty:3,unit:'パック',exp:'',expType:'期限なし',memo:'元のメモ'});items.push({id:890,name:'卵',cat:'食料品',qty:2,unit:'パック',exp:'2026-12-01',expType:'賞味期限',memo:'期限付き'});save()");
 const {stock}=setup(w,$,801,[{id:12,name:'卵',qty:2,unit:'パック'}]);
 stock.click();
 assert.equal(state(w).items.find(x=>x.id===889).qty,3,'not before the answer');
 await answer(w,true);
 const after=state(w);
 assert.equal(confirms.length,0);
 assert.equal(after.items.find(x=>x.id===889).qty,5);
 assert.equal(after.items.find(x=>x.id===889).memo,'元のメモ');
 assert.equal(after.items.find(x=>x.id===890).qty,2);
 assert.equal(after.items.find(x=>x.id===890).memo,'期限付き');
 dom.window.close();
});
test('a double click cannot commit the same routine twice',async()=>{
 const {dom,w,$}=browser();const {stock}=setup(w,$);
 stock.click();
 const ok=dialog(w).querySelector('.atk-confirm-primary');
 ok.click();ok.click();await settle();
 const saved=state(w);
 assert.equal(saved.items.filter(x=>x.name==='パンパース おむつ パンツ M').reduce((n,x)=>n+x.qty,0),2,'added once');
 w.go('buy');$('routineList').querySelector('[data-bf-routine-stock="801"]').click();
 assert.equal(dialog(w),null,'an immediate repeat tap does not ask again');
 assert.deepEqual(state(w),saved);
 dom.window.close();
});
test('failed write does not close list or change inventory, and retry works',async()=>{
 const {dom,w,$}=browser();const {card}=setup(w,$);
 card.click();const before=w.localStorage.getItem('atokoreTrialV4');
 const save=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw new Error('QuotaExceededError')};
 try{
  $('atkRoutineStockCommit').click();
  await answer(w,true);
  assert.equal($('modal').classList.contains('on'),true);
  assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
  assert.ok(dialog(w),'the confirmation stays open for a retry');
  assert.match(dialog(w).textContent,/保存できませんでした/);
 }finally{w.Storage.prototype.setItem=save}
 await answer(w,true);
 assert.equal(dialog(w),null);
 assert.equal($('modal').classList.contains('on'),false);
 assert.ok(state(w).items.some(x=>x.name.includes('パンパース')));
 dom.window.close();
});
test('empty routine never writes stock, even if stock button is pressed',()=>{
 const {dom,w,$,alerts,confirms}=browser();const {stock}=setup(w,$,801,[]);
 const raw=w.localStorage.getItem('atokoreTrialV4');
 stock.click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),raw);
 assert.equal($('pg-buy').classList.contains('on'),true);
 assert.equal(confirms.length,0);
 assert.equal(dialog(w),null);
 assert.match($('stableToastV125h').textContent,/商品がありません/);
 dom.window.close();
});
