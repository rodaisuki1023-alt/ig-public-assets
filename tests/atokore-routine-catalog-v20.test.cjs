const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js']){
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 }
 return {dom,w,$:id=>w.document.getElementById(id)};
}
function makeRoutine(w,$,name='いつものやつ'){
 w.newRoutine();$('newRoutineName').value=name;w.createRoutine();
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));const r=saved.routines.find(x=>x.name===name);
 assert.ok(r,'routine created and persisted');
 assert.ok($('atkRoutineCatalogOpen'),'new catalog button in the edit sheet');
 return r;
}
function chooseEgg(w,$){
 w.AtokoreQuickAdd.setCategory('食料品');
 const egg=$('qaTiles').querySelector('[data-qa-pick="卵"]');assert.ok(egg);
 egg.click();
}
test('repeat list edit modal offers a prominent direct catalog button',()=>{
 const {dom,w,$}=browser();makeRoutine(w,$);
 assert.match($('atkRoutineCatalogOpen').textContent,/商品一覧から追加/);
 const help=$('sheet').querySelector('.atk-routine-catalog-entry p');
 assert.match(help.textContent,/ストック数は増えません/);
 const css=fs.readFileSync(path.join(base,'routine-catalog-v20.css'),'utf8');
 assert.match(css,/min-height:52px/);
 dom.window.close();
});
test('pick baby and groceries from repeat-list editor, save ONLY the repeat list, return to the modal',()=>{
 const {dom,w,$}=browser();const r=makeRoutine(w,$);
 const before=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 $('atkRoutineCatalogOpen').click();
 assert.ok($('pg-add').classList.contains('on'));
 assert.equal($('modal').classList.contains('on'),false);
 assert.equal($('qaRoutinePicker').hidden,false);
 assert.equal($('bfDestination').hidden,true);
 assert.match($('qaRoutinePicker').textContent,/いつものリストに商品を追加/);
 chooseEgg(w,$);
 w.AtokoreQuickAdd.setCategory('ベビー');
 for(const [field,value] of [['kind','wipes'],['brand','ピジョン'],['type','本体']]){
  const button=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');
  assert.ok(button,field+' '+value);button.click();
 }
 $('qaBaby').querySelector('[data-qa-babyadd]').click();
 assert.equal(w.AtokoreQuickAdd.getTray().length,2);
 const prior=w.localStorage.getItem('atokoreTrialV4');
 assert.deepEqual(JSON.parse(prior).items,before.items);
 assert.deepEqual(JSON.parse(prior).buys,before.buys);
 assert.equal($('qaCommit').textContent,'選んだ商品をいつものリストに追加');
 $('qaCommit').click();
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),false);
 assert.equal($('modal').classList.contains('on'),true,'original edit sheet reopens');
 assert.ok($('atkRoutineCatalogOpen'));
 assert.match($('sheet').textContent,/卵/);
 assert.match($('sheet').textContent,/ピジョン/);
 const after=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.deepEqual(after.items,before.items,'inventory untouched');
 assert.deepEqual(after.buys,before.buys,'shopping list untouched');
 const routine=after.routines.find(x=>x.id===r.id);
 assert.ok(routine.items.some(x=>x.name==='卵'));
 assert.ok(routine.items.some(x=>x.name.includes('ピジョン')));
 assert.equal(routine.items.length,2);
 dom.window.close();
});
test('save failure does not mutate routine, stock or shopping, and keeps staged products',()=>{
 const {dom,w,$}=browser();makeRoutine(w,$);
 $('atkRoutineCatalogOpen').click();chooseEgg(w,$);
 const before=w.localStorage.getItem('atokoreTrialV4');
 const original=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw new Error('QuotaExceededError')};
 try{
  $('qaCommit').click();
  assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
  assert.equal(w.AtokoreQuickAdd.getTray().length,1);
  assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),true);
  assert.equal($('modal').classList.contains('on'),false);
 }finally{w.Storage.prototype.setItem=original}
 $('qaCommit').click();
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),false);
 assert.ok(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).routines[0].items.length);
 dom.window.close();
});
test('back to routine never changes inventory, and ordinary stock-add flow remains intact',()=>{
 const {dom,w,$}=browser();makeRoutine(w,$);
 const previous=w.localStorage.getItem('atokoreTrialV4');
 $('atkRoutineCatalogOpen').click();chooseEgg(w,$);
 $('qaRoutinePicker').querySelector('[data-qa-routine-back]').click();
 assert.equal(w.AtokoreQuickAdd.isRoutinePicker(),false);
 assert.equal($('modal').classList.contains('on'),true);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),previous);
 w.closeM();w.atkOpenAdd('stock');w.AtokoreQuickAdd.setCategory('食料品');
 assert.equal($('qaRoutinePicker').hidden,true);
 assert.equal($('bfDestination').hidden,false);
 chooseEgg(w,$);
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 $('qaCommit').click();
 const after=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(after.items.some(x=>x.name==='卵'&&x.qty>=1));
 assert.equal(after.routines[0].items.length,0);
 dom.window.close();
});
test('trial script and stylesheet included in offline shell',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/routine-catalog-v20\.js\?v=20/);
 assert.match(html,/routine-catalog-v20\.css\?v=20/);
 assert.ok(html.indexOf('baby-flow-v17.js')<html.indexOf('routine-catalog-v20.js'));
 assert.match(sw,/'\.\/routine-catalog-v20.js'/);
 assert.match(sw,/'\.\/routine-catalog-v20.css'/);
});
