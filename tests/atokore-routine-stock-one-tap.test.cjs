const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'https://example.invalid/preview-baby-v19/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;let alerts=[];w.alert=msg=>alerts.push(msg);w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const f of ['data-safety-v19.js','ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js','routine-catalog-v20.js'])w.eval(fs.readFileSync(path.join(base,f),'utf8'));
 return {dom,w,alerts,$:id=>w.document.getElementById(id)};
}
function setup(w,$,id=801,entries=[{id:11,name:'パンパース おむつ パンツ M',qty:2,unit:'袋'},{id:12,name:'卵',qty:1,unit:'パック'}]){
 w.eval('routines.push('+JSON.stringify({id,name:'いつものセット',items:entries})+');renderRoutines();save()');
 assert.ok($('routineList').querySelector('[data-bf-routine="'+id+'"]'));
 w.go('buy');
}
function get(w){return JSON.parse(w.localStorage.getItem('atokoreTrialV4'))}
test('one tap on stock CTA commits items and routes directly to stock, not product-add screen',()=>{
 const {dom,w,$}=browser();
 setup(w,$);
 const before=get(w), stock=$('routineList').querySelector('.bf-routine-actions [data-bf-routine="801"]');
 assert.equal(stock.textContent,'＋ ストックに追加');
 stock.click();
 assert.equal($('pg-stock').classList.contains('on'),true);
 assert.equal($('pg-add').classList.contains('on'),false);
 assert.equal(w.AtokoreQuickAdd.getTray().length,0);
 const after=get(w);
 assert.equal(after.routines.length,before.routines.length);
 assert.deepEqual(after.routines,before.routines);
 assert.deepEqual(after.buys,before.buys);
 assert.ok(after.items.some(x=>x.name==='パンパース おむつ パンツ M'&&x.qty===2));
 assert.ok(after.items.some(x=>x.name==='卵'&&x.unit==='パック'));
 dom.window.close();
});
test('existing matching stock is increased, unrelated and dated stock are preserved',()=>{
 const {dom,w,$}=browser();
 w.eval("items.push({id:889,name:'卵',cat:'食料品',qty:3,unit:'パック',exp:'',expType:'期限なし',memo:'元のメモ'});items.push({id:890,name:'卵',cat:'食料品',qty:2,unit:'パック',exp:'2026-12-01',expType:'賞味期限',memo:'期限付き'});save()");
 setup(w,$,801,[{id:12,name:'卵',qty:2,unit:'パック'}]);
 $('routineList').querySelector('[data-bf-routine="801"]').click();
 const after=get(w);
 assert.equal(after.items.find(x=>x.id===889).qty,5);
 assert.equal(after.items.find(x=>x.id===889).memo,'元のメモ');
 assert.equal(after.items.find(x=>x.id===890).qty,2);
 assert.equal(after.items.find(x=>x.id===890).memo,'期限付き');
 dom.window.close();
});
test('rapid double click of same repeat set does not add twice',()=>{
 const {dom,w,$}=browser();setup(w,$);
 const button=$('routineList').querySelector('.bf-routine-actions [data-bf-routine="801"]');
 button.click();const saved=get(w);
 button.click();
 assert.deepEqual(get(w),saved);
 dom.window.close();
});
test('failed storage write does not navigate or change inventory',()=>{
 const {dom,w,$,alerts}=browser();setup(w,$);
 const orig=w.localStorage.getItem('atokoreTrialV4');
 const button=$('routineList').querySelector('.bf-routine-actions [data-bf-routine="801"]');
 const setter=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(){throw new Error('QuotaExceededError')};
 try{
  button.click();
  assert.equal($('pg-stock').classList.contains('on'),false);
  assert.equal($('pg-buy').classList.contains('on'),true);
  assert.equal(w.localStorage.getItem('atokoreTrialV4'),orig);
  assert.match(alerts.join(' '),/保存できませんでした/);
 }finally{w.Storage.prototype.setItem=setter}
 button.click();
 assert.equal($('pg-stock').classList.contains('on'),true,'user can retry after failure');
 dom.window.close();
});
test('empty routine does not change storage or move the page',()=>{
 const {dom,w,$,alerts}=browser();setup(w,$,801,[]);
 const raw=w.localStorage.getItem('atokoreTrialV4');
 $('routineList').querySelector('.bf-routine-actions [data-bf-routine="801"]').click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),raw);
 assert.equal($('pg-buy').classList.contains('on'),true);
 assert.match(alerts.join(' '),/商品がありません/);
 dom.window.close();
});
