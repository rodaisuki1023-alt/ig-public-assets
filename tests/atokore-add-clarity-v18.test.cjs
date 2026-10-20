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
test('fixed add CTA does not obstruct routine and stock detail modals',()=>{
 const {dom,w,$}=browser(),fab=$('bfAddFab');
 assert.equal(fab.textContent,'＋ 商品を追加');
 assert.equal(fab.hidden,false,'CTA visible when browsing home');
 w.openM('<div>いつものリストを編集</div>');
 assert.equal($('modal').classList.contains('on'),true);
 assert.equal(fab.hidden,true,'CTA hidden while routine sheet is open');
 w.closeM();
 assert.equal(fab.hidden,false,'CTA returns when modal closes');
 w.go('stock');
 const stock=w.document.querySelector('#stockList [data-stock-id]');
 if(stock){stock.click();assert.equal(fab.hidden,true,'CTA hidden while stock sheet is open');w.closeM()}
 w.go('add');assert.equal(fab.hidden,true,'CTA hidden on add page');
 w.go('home');assert.equal(fab.hidden,false,'CTA visible after leaving add page');
 const css=fs.readFileSync(path.join(base,'add-clarity-v18.css'),'utf8');
 assert.match(css,/#modal\.on\) #bfAddFab/);
 assert.match(css,/#bfAddFab\[hidden\]/);
 assert.match(css,/z-index:150!important/);
 dom.window.close();
});
test('baby button matches target: stock selection then confirmed save',()=>{
 const {dom,w,$}=browser(),fab=$('bfAddFab');
 fab.click();
 assert.equal($('pg-add').classList.contains('on'),true);
 assert.equal(fab.hidden,true);
 assert.ok($('bfDestination').querySelector('[data-qa-dest="stock"]').classList.contains('selected'));
 let babyButton=$('qaBaby').querySelector('[data-qa-babyadd]');
 assert.equal(babyButton.textContent,'＋ ストックに追加');
 assert.match($('qaBaby').textContent,/まとめて追加.*保存/);
 // Wipes don't require an arbitrary size; manufacturer and package type are required.
 for(const [field,value] of [['kind','wipes'],['brand','ピジョン'],['type','本体']]){
  const b=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');
  assert.ok(b,field+'='+value);b.click();
 }
 babyButton=$('qaBaby').querySelector('[data-qa-babyadd]');
 assert.equal(babyButton.textContent,'＋ ストックに追加');
 const before=w.localStorage.getItem('atokoreTrialV4');
 babyButton.click();
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before,'selection must not prematurely save stock');
 assert.equal(w.AtokoreQuickAdd.getTray().length,1);
 assert.equal($('qaCommit').textContent,'まとめてストックに追加');
 $('qaCommit').click();
 assert.ok(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.some(x=>x.name.includes('ピジョン')));
 assert.equal(fab.hidden,false,'returns to stock page after commit');
 dom.window.close();
});
test('shopping page opens add with correct label and does not modify stock',()=>{
 const {dom,w,$}=browser(),fab=$('bfAddFab');
 const previousItems=w.localStorage.getItem('atokoreTrialV4');
 w.go('buy');fab.click();
 assert.equal($('qaBaby').querySelector('[data-qa-babyadd]').textContent,'＋ 買い物リストに追加');
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
 const {dom,w,$}=browser();$('bfAddFab').click();
 const target=$('qaBaby').querySelector('[data-qa-babyadd]');
 assert.equal(target.textContent,'＋ ストックに追加');
 $('bfDestination').querySelector('[data-qa-dest="buy"]').click();
 assert.equal($('qaBaby').querySelector('[data-qa-babyadd]').textContent,'＋ 買い物リストに追加');
 $('bfDestination').querySelector('[data-qa-dest="stock"]').click();
 assert.equal($('qaBaby').querySelector('[data-qa-babyadd]').textContent,'＋ ストックに追加');
 dom.window.close();
});
test('pwa includes v18 overrides in correct order and cache refresh',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/add-clarity-v18\.css\?v=18/);
 assert.match(html,/quick-add\.js\?v=18/);
 assert.match(html,/baby-flow-v17\.js\?v=18/);
 assert.ok(html.indexOf('baby-focus-v17.css')<html.indexOf('add-clarity-v18.css'));
 assert.match(sw,/atokore-pwa-v18/);
 assert.match(sw,/'\.\/add-clarity-v18.css'/);
});
