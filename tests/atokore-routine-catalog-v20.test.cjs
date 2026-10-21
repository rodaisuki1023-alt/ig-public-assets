const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])
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
function stockRow($,name){
 const row=Array.from($('stockList').querySelectorAll('[data-stock-id]')).find(el=>el.textContent.includes(name));
 assert.ok(row,'stock row exists: '+name);
 return row;
}
test('one tap from repeat-list editor navigates directly to real stock list',()=>{
 const {dom,w,$}=browser();create(w,$);
 assert.equal($('atkRoutineCatalogOpen').textContent,'商品を選ぶ');
 $('atkRoutineCatalogOpen').click();
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
test('stock milk and diaper taps persist two repeat items without changing inventory or shopping',()=>{
 const {dom,w,$}=browser(),id=create(w,$),before=stored(w);
 $('atkRoutineCatalogOpen').click();
 stockRow($,'牛乳').click();
 let after=stored(w);
 assert.deepEqual(after.items,before.items);
 assert.deepEqual(after.buys,before.buys);
 assert.equal(after.routines.find(r=>r.id===id).items.length,1);
 assert.match(stockRow($,'牛乳').textContent,/追加済み/);
 stockRow($,'オムツ').click();
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
test('cancel the stock-item confirmation to prevent accidental additions to the repeat list',()=>{
 const {dom,w,$}=browser(),id=create(w,$);
 $('atkRoutineCatalogOpen').click();
 const before=w.localStorage.getItem('atokoreTrialV4');
 let prompts=0;
 w.confirm=msg=>{prompts++;assert.match(msg,/追加してもいいですか/);assert.match(msg,/ストック数は変わりません/);return false};
 stockRow($,'牛乳').click();
 assert.equal(prompts,1);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'cancelled item is not saved');
 assert.equal(stored(w).routines.find(r=>r.id===id).items.length,0);
 w.confirm=()=>true;
 stockRow($,'牛乳').click();
 assert.equal(stored(w).routines.find(r=>r.id===id).items.length,1);
 dom.window.close();
});
test('repeat tap does not increase item quantity',()=>{
 const {dom,w,$}=browser(),id=create(w,$);
 $('atkRoutineCatalogOpen').click();
 const row=stockRow($,'牛乳');row.click();
 const snapshot=w.localStorage.getItem('atokoreTrialV4');
 row.click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),snapshot);
 assert.equal(stored(w).routines.find(r=>r.id===id).items[0].qty,1);
 assert.match($('atkRoutineStockNotice').textContent,/追加済み/);
 dom.window.close();
});
test('stock quantity buttons cannot change inventory in select mode',()=>{
 const {dom,w,$}=browser();create(w,$);
 const before=stored(w);
 $('atkRoutineCatalogOpen').click();
 const row=stockRow($,'牛乳'),button=row.querySelector('button');
 assert.ok(button,'stock row adjustment control exists');
 button.click();
 assert.deepEqual(stored(w).items,before.items);
 assert.equal(stored(w).routines[0].items.length,1);
 dom.window.close();
});
test('storage failure keeps picker active and allows retry',()=>{
 const {dom,w,$}=browser();create(w,$);
 $('atkRoutineCatalogOpen').click();
 const before=w.localStorage.getItem('atokoreTrialV4'),original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw new Error('QuotaExceeded')};
 try{
  stockRow($,'牛乳').click();
  assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
  assert.equal(w.AtokoreRoutineCatalog.isActive(),true);
  assert.match($('atkRoutineStockNotice').textContent,/保存できませんでした/);
 }finally{w.Storage.prototype.setItem=original}
 stockRow($,'牛乳').click();
 assert.equal(stored(w).routines[0].items.length,1);
 dom.window.close();
});
test('leaving the picker restores normal stock controls',()=>{
 const {dom,w,$}=browser();create(w,$);
 $('atkRoutineCatalogOpen').click();w.go('home');
 assert.equal(w.AtokoreRoutineCatalog.isActive(),false);
 w.go('stock');
 assert.equal($('atkRoutineStockPicker').hidden,true);
 assert.equal(w.document.body.classList.contains('atk-routine-stock-mode'),false);
 assert.match($('pg-stock').querySelector('.atk-stock-hint').textContent,/在庫を増減/);
 dom.window.close();
});
test('script and stylesheet cache versions updated',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/routine-catalog-v20\.js\?v=24/);
 assert.match(html,/routine-catalog-v20\.css\?v=24/);
 assert.match(sw,/CACHE_VERSION = 'atokore-pwa-v24'/);
 const css=fs.readFileSync(path.join(base,'routine-catalog-v20.css'),'utf8');
 assert.match(css,/atk-routine-stock-mode/);
});
