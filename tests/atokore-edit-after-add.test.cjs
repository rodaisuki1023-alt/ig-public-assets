const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
const editor=require('../atokore-live-v125/edit-after-add.js');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/atokore/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const name of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','quick-add.js','edit-after-add.js']){
  w.eval(fs.readFileSync(path.join(base,name),'utf8'));
 }
 return {dom,w,$:id=>w.document.getElementById(id)};
}
test('show a prominently labeled stock add action and no detailed entry mode',()=>{
 const {dom,w,$}=browser();
 assert.equal($('qaSwitchDetails'),null);
 w.atkOpenAdd();
 assert.ok($('qaPanel').textContent.includes('かんたん登録'));
 const nav=w.document.querySelector('.tabs .tab[data-p="add"]');
 assert.match(nav.textContent,/ストック追加/);
 assert.notEqual(nav.style.display,'none');
 assert.match($('pg-stock').querySelector('.atk-page-title button').textContent,/ストック追加/);
 nav.click();assert.ok($('pg-add').classList.contains('on'));
 dom.window.close();
});
test('tap egg stock and save its expiration, location and memo without touching other stock',()=>{
 const {dom,w,$}=browser();
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');$('qaTiles').querySelector('[data-qa-pick="卵"]').click();$('qaBar').click();$('qaCommit').click();
 const existing=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const stock=existing.items.find(x=>x.name==='卵'&&!x.exp);
 assert.ok(stock,'quick-add stock exists');
 const unrelated=existing.items.find(x=>x.id!==stock.id);
 w.atkShowDetail(stock.id);
 assert.match($('sheet').textContent,/商品情報を編集する/);
 $('sheet').querySelector('.atk-edit-open').click();
 const form=$('atkEditForm');assert.ok(form);
 assert.equal(form.elements.namedItem('name').value,'卵');
 form.elements.namedItem('qty').value='3';
 form.elements.namedItem('unit').value='パック';
 form.elements.namedItem('expType').value='賞味期限';
 form.elements.namedItem('expType').dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal($('atkEditExpiryWrap').hidden,false);
 form.elements.namedItem('exp').value='2026-10-29';
 form.elements.namedItem('place').value='冷蔵庫';
 form.elements.namedItem('memo').value='家族用 10個入り';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal($('modal').classList.contains('on'),false);
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const edited=saved.items.find(x=>x.id===stock.id);
 assert.equal(edited.qty,3);assert.equal(edited.expType,'賞味期限');assert.equal(edited.exp,'2026-10-29');
 assert.equal(edited.place,'冷蔵庫');assert.equal(edited.memo,'家族用 10個入り');
 if(unrelated)assert.deepEqual(saved.items.find(x=>x.id===unrelated.id),unrelated);
 w.atkShowDetail(stock.id);assert.match($('sheet').textContent,/商品情報を編集する/);
 dom.window.close();
});
test('invalid edits remain open and do not alter stored inventory',()=>{
 const {dom,w,$}=browser();
 w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');$('qaTiles').querySelector('[data-qa-pick="卵"]').click();$('qaBar').click();$('qaCommit').click();
 const before=w.localStorage.getItem('atokoreTrialV4');
 const stock=JSON.parse(before).items.find(x=>x.name==='卵'&&!x.exp);
 w.atokoreEditStock(stock.id);
 const form=$('atkEditForm');
 form.elements.namedItem('name').value=' ';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal($('modal').classList.contains('on'),true);
 assert.match($('atkEditError').textContent,/商品名/);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
 // Removing expiry type also clears the date in the updated object.
 form.elements.namedItem('name').value='卵';
 form.elements.namedItem('expType').value='期限なし';
 form.elements.namedItem('qty').value='1.5';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.match($('atkEditError').textContent,/整数/);
 assert.equal(w.localStorage.getItem('atokoreTrialV4'),before);
 dom.window.close();
});
test('editing preserves brand, type and size of baby inventory',()=>{
 const {dom,w,$}=browser();
 w.atkOpenAdd();$('qaTabs').querySelector('[data-qa-cat="ベビー"]').click();
 for(const [k,v] of [['brand','パンパース'],['type','パンツ'],['size','M']]){
  const b=$('qaBaby').querySelector('[data-qa-baby="'+k+'"][data-value="'+v+'"]');assert.ok(b);b.click();
 }
 $('qaBaby').querySelector('[data-qa-babyadd]').click();$('qaBar').click();$('qaCommit').click();
 const arr=JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items;
 const baby=arr.find(x=>x.name.includes('パンパース')&&x.name.endsWith(' M'));
 assert.ok(baby);
 w.atokoreEditStock(baby.id);
 const form=$('atkEditForm');form.elements.namedItem('memo').value='テープと混ぜない';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.find(x=>x.id===baby.id);
 assert.equal(saved.name,baby.name);assert.equal(saved.memo,'テープと混ぜない');
 dom.window.close();
});
test('explicit validation and preview-scoped service worker resources',()=>{
 const sample={id:1,name:'卵',qty:1,cat:'食料品',unit:'パック'};
 assert.throws(()=>editor.validate({name:'',qty:1,cat:'食料品',unit:'個'},sample),/商品名/);
 assert.throws(()=>editor.validate({name:'卵',qty:-1,cat:'食料品',unit:'個'},sample),/在庫数/);
 assert.throws(()=>editor.validate({name:'卵',qty:1,cat:'食料品',unit:'個',expType:'賞味期限'},sample),/期限日/);
 // Optional reorder line: empty keeps the default, integers 0-9999 only.
 assert.throws(()=>editor.validate({name:'卵',qty:1,cat:'食料品',unit:'個',minQty:'10000'},sample),/補充の目安/);
 assert.throws(()=>editor.validate({name:'卵',qty:1,cat:'食料品',unit:'個',minQty:'1.5'},sample),/補充の目安/);
 assert.equal(editor.validate({name:'卵',qty:1,cat:'食料品',unit:'個',minQty:'0'},sample).minQty,0);
 assert.equal('minQty' in editor.validate({name:'卵',qty:1,cat:'食料品',unit:'個',minQty:''},{...sample,minQty:4}),false);
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const worker=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/edit-after-add\.js\?v=39/);
 assert.match(html,/edit-after-add\.css\?v=39/);
 assert.match(worker,/'\.\/edit-after-add.js'/);
 assert.match(worker,/atokore-pwa-v40/);
});
