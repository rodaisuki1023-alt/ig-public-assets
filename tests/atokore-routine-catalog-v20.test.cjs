const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['common-v45.js','data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 return {dom,w,$:id=>w.document.getElementById(id)};
}
function create(w,$){
 w.newRoutine();$('newRoutineName').value='いつものやつ';w.createRoutine();
 const stored=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const id=stored.routines.find(x=>x.name==='いつものやつ')?.id;
 assert.ok(id,'repeat list created');assert.ok($('atkRoutineCatalogOpen'),'entry exists');
 return id;
}
const stored=w=>JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
// W2: every confirmation is the app's own dialog (#atkConfirm); native confirm() is never asked.
const dialog=w=>w.document.getElementById('atkConfirm');
const settle=()=>new Promise(r=>setTimeout(r,0));
async function answer(w,accept){
 const d=dialog(w);assert.ok(d,'the app shows its own confirmation');
 d.querySelector(accept?'.atk-confirm-primary':'button:not(.atk-confirm-primary)').click();await settle();
}
function noNativeConfirm(w){w.confirm=()=>{throw new Error('native confirm() must not be used')}}
function stockRow($,name){
 const row=Array.from($('stockList').querySelectorAll('[data-stock-id]')).find(el=>el.textContent.includes(name));
 assert.ok(row,'stock row exists: '+name);
 return row;
}
function pickBanana(w,$){
 w.AtokoreQuickAdd.setCategory('食料品');
 w.document.querySelector('[data-qa-pick="バナナ"]').click();
}
test('main product button opens add catalog and confirms an unregistered product for the routine only',()=>{
 const {dom,w,$}=browser(),id=create(w,$),before=stored(w);
 $('atkRoutineCatalogOpen').click();
 assert.equal($('pg-add').classList.contains('on'),true);
 assert.equal($('modal').classList.contains('on'),false);
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),true);
 assert.equal($('bfDestination').hidden,true);
 pickBanana(w,$);
 // v36: the review screen is the confirmation (no extra dialog on top of it).
 let prompts=0;
 w.confirm=()=>{prompts++;return true};
 const raw=w.localStorage.getItem('atokoreTrialV4');
 $('qaCommit').click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),raw,'nothing is saved before the list is reviewed');
 $('qaBar').click();
 assert.match($('qaTrayList').textContent,/バナナ/);
 assert.match($('qaTrayList').textContent,/在庫数は変わりません/);
 assert.match($('qaTrayDest').textContent,/いつものリスト/);
 assert.equal($('qaCommit').textContent,'選んだ商品をいつものリストに追加');
 assert.equal($('qaTray').querySelector('.qa-review-dest-switch').hidden,true,'the routine destination cannot be switched to stock');
 $('qaTray').querySelector('[data-qa-review-back]').click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),raw,'going back saves nothing');
 assert.equal(w.AtokoreQuickAdd.getTray().length,1);
 $('qaBar').click();$('qaCommit').click();$('qaCommit').click();
 const after=stored(w);
 assert.deepEqual(after.items,before.items);assert.deepEqual(after.buys,before.buys);
 assert.equal(after.routines.find(x=>x.id===id).items.length,1);
 assert.match(after.routines.find(x=>x.id===id).items[0].name,/バナナ/);
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),false);
 assert.equal($('pg-buy').classList.contains('on'),true);
 assert.equal($('modal').classList.contains('on'),true);
 assert.equal(prompts,0);
 dom.window.close();
});
test('catalog save failure retains selection and memory for a safe retry',()=>{
 const {dom,w,$}=browser(),id=create(w,$),before=stored(w);
 $('atkRoutineCatalogOpen').click();pickBanana(w,$);
 const original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw Error('quota')};
 try{
  $('qaBar').click();$('qaCommit').click();
  assert.deepEqual(stored(w),before);
  assert.deepEqual(JSON.parse(w.eval('JSON.stringify({items,buys,routines})')),before);
  assert.equal(w.AtokoreQuickAdd.getTray().length,1);
  assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),true);
 }finally{w.Storage.prototype.setItem=original}
 $('qaBar').click();$('qaCommit').click();
 assert.equal(stored(w).routines.find(x=>x.id===id).items.length,1);
 dom.window.close();
});
test('leaving catalog asks to discard selection and cannot hijack later stock additions',async()=>{
 const {dom,w,$}=browser();create(w,$);const before=stored(w);noNativeConfirm(w);
 $('atkRoutineCatalogOpen').click();pickBanana(w,$);
 w.go('home');
 assert.match(dialog(w).textContent,/破棄して戻りますか/);
 await answer(w,false);
 assert.equal($('pg-add').classList.contains('on'),true);
 assert.equal(w.AtokoreQuickAdd.getTray().length,1);
 w.go('home');
 await answer(w,true);
 assert.equal($('pg-home').classList.contains('on'),true,'the navigation continues after confirming');
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),false);
 assert.equal(w.AtokoreQuickAdd.getTray().length,0);
 assert.deepEqual(stored(w),before);
 w.atkOpenAdd();pickBanana(w,$);$('qaBar').click();$('qaCommit').click();
 const after=stored(w);
 assert.deepEqual(after.routines,before.routines);
 assert.equal(after.items.length,before.items.length+1);
 dom.window.close();
});
test('compatibility stock picker still selects only saved list contents',()=>{
 const {dom,w,$}=browser(),id=create(w,$);
 assert.equal($('atkRoutineCatalogOpen').textContent,'商品を選ぶ');
 w.AtokoreRoutineCatalog.start(id);
 assert.equal(w.AtokoreRoutineCatalog.isActive(),true);
 assert.equal($('pg-stock').classList.contains('on'),true);
 assert.equal($('pg-add').classList.contains('on'),false);
 assert.equal($('modal').classList.contains('on'),false);
 assert.equal($('atkRoutineStockPicker').hidden,false);
 assert.match($('atkRoutineStockHeading').textContent,/いつものやつ/);
 assert.equal(w.AtokoreQuickAdd.getTray().length,0);
 assert.match(stockRow($,'牛乳').getAttribute('aria-label'),/いつものリストに追加/);
 dom.window.close();
});
test('stock milk and diaper taps persist two repeat items without changing inventory or shopping',async()=>{
 const {dom,w,$}=browser(),id=create(w,$),before=stored(w);noNativeConfirm(w);
 w.AtokoreRoutineCatalog.start(id);
 stockRow($,'牛乳').click();await answer(w,true);
 let after=stored(w);
 assert.deepEqual(after.items,before.items);
 assert.deepEqual(after.buys,before.buys);
 assert.equal(after.routines.find(r=>r.id===id).items.length,1);
 assert.match(stockRow($,'牛乳').textContent,/追加済み/);
 stockRow($,'オムツ').click();await answer(w,true);
 after=stored(w);
 assert.equal(after.routines.find(r=>r.id===id).items.length,2);
 assert.deepEqual(after.items,before.items);
 assert.deepEqual(after.buys,before.buys);
 $('atkRoutineStockDone').click();
 assert.equal(w.AtokoreRoutineCatalog.isActive(),false);
 assert.equal($('pg-buy').classList.contains('on'),true);
 assert.equal($('modal').classList.contains('on'),true);
 assert.match($('sheet').textContent,/牛乳/);
 assert.match($('sheet').textContent,/オムツ/);
 assert.ok($('atkRoutineCatalogOpen'));
 dom.window.close();
});
test('cancel the stock-item confirmation to prevent accidental additions to the repeat list',async()=>{
 const {dom,w,$}=browser(),id=create(w,$);noNativeConfirm(w);
 w.AtokoreRoutineCatalog.start(id);
 const before=w.localStorage.getItem('atokoreTrialV4');
 stockRow($,'牛乳').click();
 assert.match(dialog(w).textContent,/追加してもいいですか/);
 assert.match(dialog(w).textContent,/ストック数は変わりません/);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'nothing is saved before the answer');
 await answer(w,false);
 assert.equal(dialog(w),null);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'cancelled item is not saved');
 assert.equal(stored(w).routines.find(r=>r.id===id).items.length,0);
 stockRow($,'牛乳').click();await answer(w,true);
 assert.equal(stored(w).routines.find(r=>r.id===id).items.length,1);
 dom.window.close();
});
test('repeat tap does not increase item quantity',async()=>{
 const {dom,w,$}=browser(),id=create(w,$);noNativeConfirm(w);
 w.AtokoreRoutineCatalog.start(id);
 const row=stockRow($,'牛乳');row.click();await answer(w,true);
 const snapshot=w.localStorage.getItem('atokoreTrialV4');
 row.click();
 assert.equal(dialog(w),null,'an item already in the list is not asked again');
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),snapshot);
 assert.equal(stored(w).routines.find(r=>r.id===id).items[0].qty,1);
 assert.match($('atkRoutineStockNotice').textContent,/追加済み/);
 dom.window.close();
});
test('stock quantity buttons cannot change inventory in select mode',async()=>{
 const {dom,w,$}=browser(),id=create(w,$);noNativeConfirm(w);
 const before=stored(w);
 w.AtokoreRoutineCatalog.start(id);
 const row=stockRow($,'牛乳'),button=row.querySelector('button');
 assert.ok(button,'stock row adjustment control exists');
 button.click();
 assert.deepEqual(stored(w).items,before.items);
 await answer(w,true);
 assert.deepEqual(stored(w).items,before.items);
 assert.equal(stored(w).routines[0].items.length,1);
 dom.window.close();
});
test('storage failure keeps picker active and allows retry',async()=>{
 const {dom,w,$}=browser(),id=create(w,$);noNativeConfirm(w);
 w.AtokoreRoutineCatalog.start(id);
 const before=w.localStorage.getItem('atokoreTrialV4'),original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw new Error('QuotaExceeded')};
 try{
  stockRow($,'牛乳').click();await answer(w,true);
  assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
  assert.equal(w.AtokoreRoutineCatalog.isActive(),true);
  assert.match($('atkRoutineStockNotice').textContent,/保存できませんでした/);
  assert.match(dialog(w).textContent,/保存できませんでした/,'the confirmation stays open for a retry');
 }finally{w.Storage.prototype.setItem=original}
 await answer(w,true);
 assert.equal(dialog(w),null);
 assert.equal(stored(w).routines[0].items.length,1);
 dom.window.close();
});
test('leaving the picker restores normal stock controls',()=>{
 const {dom,w,$}=browser(),id=create(w,$);
 w.AtokoreRoutineCatalog.start(id);w.go('home');
 assert.equal(w.AtokoreRoutineCatalog.isActive(),false);
 w.go('stock');
 assert.equal($('atkRoutineStockPicker').hidden,true);
 assert.equal(w.document.body.classList.contains('atk-routine-stock-mode'),false);
 assert.match($('pg-stock').querySelector('.atk-stock-hint').textContent,/在庫を増減/);
 dom.window.close();
});
test('script and stylesheet cache versions updated',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/routine-catalog-v20\.js\?v=48/);
 assert.match(html,/routine-catalog-v20\.css\?v=24/);
 assert.match(sw,/CACHE_VERSION = 'atokore-pwa-v48\.2'/);
 const css=fs.readFileSync(path.join(base,'routine-catalog-v20.css'),'utf8');
 assert.match(css,/atk-routine-stock-mode/);
});
