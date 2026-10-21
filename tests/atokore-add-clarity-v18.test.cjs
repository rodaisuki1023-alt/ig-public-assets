const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/preview-baby-v17/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js'])
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 return {dom,w,$:id=>w.document.getElementById(id)};
}
test('v19 add action lives in the tab bar and never floats over content or sheets',()=>{
 const {dom,w,$}=browser(),tab=$('bfNavAdd');
 assert.ok(tab,'add tab exists');
 assert.equal(tab.closest('.tabs'),w.document.querySelector('.tabs'),'add action is part of the tab bar');
 assert.equal(w.document.getElementById('bfAddFab'),null,'no floating button over list controls');
 assert.equal(tab.hasAttribute('hidden'),false);
 assert.equal(tab.getAttribute('onclick'),null,'context-aware handler replaces go(add)');
 w.go('add');assert.equal(tab.getAttribute('aria-current'),'page');
 w.go('home');assert.equal(tab.getAttribute('aria-current'),null);
 const css=fs.readFileSync(path.join(base,'add-clarity-v18.css'),'utf8');
 assert.match(css,/z-index:150!important/,'sheets stay above the tab bar');
 dom.window.close();
});
test('baby button matches target: stock selection then confirmed save',()=>{
 const {dom,w,$}=browser(),fab=$('bfNavAdd');
 fab.click();
 assert.equal($('pg-add').classList.contains('on'),true);
 assert.ok($('bfDestination').querySelector('[data-qa-dest="stock"]').classList.contains('selected'));
 let babyButton=$('qaBaby').querySelector('[data-qa-babyadd]');
 assert.equal(babyButton.textContent,'＋ 追加予定に入れる','selecting is not saving');
 assert.match($('qaBaby').textContent,/まだ保存されません.*まとめてストックに追加.*保存/);
 // Wipes don't require an arbitrary size; manufacturer and package type are required.
 for(const [field,value] of [['kind','wipes'],['brand','ピジョン'],['type','本体']]){
  const b=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');
  assert.ok(b,field+'='+value);b.click();
 }
 babyButton=$('qaBaby').querySelector('[data-qa-babyadd]');
 assert.equal(babyButton.textContent,'＋ 追加予定に入れる');
 const before=w.localStorage.getItem('atokoreTrialV4');
 babyButton.click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'selection must not prematurely save stock');
 assert.equal(w.AtokoreQuickAdd.getTray().length,1);
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 $('qaCommit').click();
 assert.ok(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.some(x=>x.name.includes('ピジョン')));
 assert.equal($('pg-stock').classList.contains('on'),true,'returns to stock page after commit');
 dom.window.close();
});
test('shopping page opens add with correct label and does not modify stock',()=>{
 const {dom,w,$}=browser(),fab=$('bfNavAdd');
 const previousItems=w.localStorage.getItem('atokoreTrialV4');
 w.go('buy');fab.click();
 assert.match($('qaBaby').textContent,/まとめて買い物リストに追加/);
 assert.ok($('bfDestination').querySelector('[data-qa-dest="buy"]').classList.contains('selected'));
 for(const [field,value] of [['brand','パンパース'],['type','パンツ'],['size','M']]){
  const b=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');
  assert.ok(b);b.click();
 }
 $('qaBaby').querySelector('[data-qa-babyadd]').click();
 assert.equal($('qaCommit').textContent,'まとめて買い物リストに追加');
 const savedBefore=w.localStorage.getItem('atokoreTrialV4');
 assert.equal(savedBefore,previousItems);
 $('qaCommit').click();
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(saved.buys.some(x=>x.name.includes('パンパース')));
 const original=JSON.parse(previousItems||'null');
 if(original)assert.deepEqual(saved.items,original.items);
 dom.window.close();
});
test('switching destination updates visible wording without resetting selected item',()=>{
 const {dom,w,$}=browser();$('bfNavAdd').click();
 for(const [field,value] of [['brand','パンパース'],['type','テープ'],['size','M']])$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]').click();
 $('qaBaby').querySelector('[data-qa-babyadd]').click();
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 assert.match($('qaTrayDest').textContent,/保存先：ストック/);
 $('bfDestination').querySelector('[data-qa-dest="buy"]').click();
 assert.equal($('qaCommit').textContent,'まとめて買い物リストに追加');
 assert.match($('qaTrayDest').textContent,/保存先：買い物リスト/);
 assert.equal(w.AtokoreQuickAdd.getTray().length,1,'selected items are kept');
 $('bfDestination').querySelector('[data-qa-dest="stock"]').click();
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 dom.window.close();
});
test('pwa includes v18 overrides in correct order and cache refresh',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/add-clarity-v18\.css\?v=18/);
 assert.match(html,/quick-add\.js\?v=18/);
 assert.match(html,/baby-flow-v17\.js\?v=22/);
 assert.ok(html.indexOf('baby-focus-v17.css')<html.indexOf('add-clarity-v18.css'));
 assert.match(sw,/atokore-pwa-v20/);
 assert.match(sw,/'\.\/add-clarity-v18.css'/);
 assert.match(sw,/'\.\/p0-fixes-v19.css'/);
});
