const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

test('mobile peach UI lets a user register a branded item, change quantity and buy it',()=>{
 const base=path.resolve(__dirname,'../atokore-live-v125');
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://example.invalid/atokore/',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const f of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js']){
  w.eval(fs.readFileSync(path.join(base,f),'utf8'));
 }
 const $=id=>w.document.getElementById(id);
 assert.ok($('atkLowCount'),'home summary has been rendered');
 assert.ok($('atkTasks'),'home task list has been rendered');
 assert.equal(w.document.querySelector('.tab[data-p="add"]').style.display,'none');
 w.atkOpenAdd();assert.equal($('addCat').value,'ベビー');
 $('atkBrand').value='mamypoko';
 $('atkBrand').dispatchEvent(new w.Event('change',{bubbles:true}));
 $('atkSeries').value='マミーポコパンツ';
 $('atkSeries').dispatchEvent(new w.Event('change',{bubbles:true}));
 $('atkSize').value='L';
 $('atkSize').dispatchEvent(new w.Event('change',{bubbles:true}));
 $('addQty').value='2';
 assert.match($('addName').value,/マミーポコ/);
 w.atkSubmitItem();
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 const product=saved.items.find(x=>x.name.includes('マミーポコ'));
 assert.ok(product,'brand item was persisted to the unchanged storage key');
 assert.equal(product.qty,2);
 assert.ok(w.document.getElementById('stockList').textContent.includes('MamyPoko'));
 w.adj(product.id,-1);
 const next=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.equal(next.items.find(x=>x.id===product.id).qty,1);
 w.addStockOneToBuyV125H(product.id);
 assert.ok(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).buys.some(x=>x.name.includes('マミーポコ')));
 w.go('home');assert.ok(Number($('atkLowCount').textContent)>=1);
 dom.window.close();
});
