const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.resolve(__dirname,'../atokore-live-v125');
function browser(){
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'https://example.invalid/preview-baby-v17/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const file of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','baby-kit-v17.js','quick-add.js','edit-after-add.js','baby-flow-v17.js'])
  w.eval(fs.readFileSync(path.join(base,file),'utf8'));
 return {dom,w,$:id=>w.document.getElementById(id)};
}
function choose($,kind,brand,type,size){
 const tap=(field,value)=>{const button=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');assert.ok(button,field+' '+value);button.click()};
 tap('kind',kind);tap('brand',brand);tap('type',type);if(size)tap('size',size);
 $('qaBaby').querySelector('[data-qa-babyadd]').click();
}
test('single row navigation with the add action in the centre of the tab bar',()=>{
 const {dom,w,$}=browser();
 const add=w.document.querySelector('.tabs .tab[data-p="add"]');
 assert.equal(add.style.getPropertyValue('display'),'','v19 shows the add tab instead of a floating button');
 assert.equal(add.id,'bfNavAdd');
 assert.equal(w.document.querySelectorAll('.tabs .tab').length,5);
 assert.match(add.textContent,/追加/);
 assert.equal($('pg-stock').querySelector('.atk-page-title button').textContent,'＋ ストック追加');
 const css=fs.readFileSync(path.join(base,'p0-fixes-v19.css'),'utf8');
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.tabs \.tab\[data-p="add"\]\{\s*display:flex!important/);
 $('bfNavAdd').click();
 assert.ok($('pg-add').classList.contains('on'));
 assert.ok($('qaBaby').textContent.includes('おしりふき'));
 assert.ok($('bfDestination').querySelector('[data-qa-dest="stock"]').classList.contains('selected'));
 dom.window.close();
});
test('wipes are distinct by brand and pack mode; no guesswork about manufacturer',()=>{
 const {dom,w,$}=browser();$('bfNavAdd').click();
 choose($,'wipes','ムーニー','詰替');
 choose($,'wipes','ピジョン','本体');
 const tray=w.AtokoreQuickAdd.getTray();
 assert.equal(tray.length,2);
 assert.ok(tray.some(x=>x.name.includes('ムーニー')&&x.name.includes('詰替')));
 assert.ok(tray.some(x=>x.name.includes('ピジョン')&&x.name.includes('本体')));
 $('qaCommit').click();
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items;
 assert.ok(saved.some(x=>x.name.includes('ムーニー おしりふき')));
 assert.ok(saved.some(x=>x.name.includes('ピジョン おしりふき')));
 assert.match($('stockList').innerHTML,/bf-baby-product/);
 assert.match($('stockList').textContent,/ピジョン/);
 dom.window.close();
});
test('diaper and formula render individual original baby icons, full brand names',()=>{
 const {dom,w,$}=browser();$('bfNavAdd').click();
 choose($,'diaper','マミーポコ','パンツ','L');
 choose($,'milk','明治','キューブ');
 $('qaCommit').click();
 const list=$('stockList').innerHTML;
 assert.match(list,/マミーポコ/);
 assert.match(list,/明治/);
 assert.match(list,/bf-icon-diaper/);
 assert.match(list,/bf-icon-milk/);
 const b=w.AtokoreBabyKit;
 assert.equal(b.kind('ムーニー おしりふき 詰替'),'wipes');
 assert.equal(b.kind('明治 ほほえみ 粉ミルク キューブ'),'milk');
 assert.equal(b.kind('パンパース おむつ パンツ M'),'diaper');
 assert.ok(!b.icon('diaper').includes('http://example'));
 dom.window.close();
});
test('routine card opens details, then confirmed stock button applies inventory, shopping stays separate',()=>{
 const {dom,w,$}=browser();
 w.eval("routines.push({id:901,name:'毎週の買い物',items:[{id:1,name:'卵',qty:1,unit:'パック'},{id:2,name:'牛乳',qty:2,unit:'本'}]});renderRoutines();");
 const card=$('routineList').querySelector('[data-bf-routine="901"]');
 assert.ok(card);const previous=w.document.querySelector('#stockList').textContent;
 card.click();
 assert.equal($('modal').classList.contains('on'),true,'card is read-only');
 assert.equal(w.document.querySelector('#stockList').textContent,previous);
 assert.ok($('atkRoutineStockCommit'));
 $('atkRoutineStockCommit').click();
 assert.ok($('pg-stock').classList.contains('on'));
 assert.equal($('pg-add').classList.contains('on'),false,'do not open extra selection screen');
 assert.equal(w.AtokoreQuickAdd.getTray().length,0,'direct stock add must not stage items');
 let data=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(data.items.some(x=>x.name==='卵'));
 assert.ok(data.items.some(x=>x.name==='牛乳'));
 const beforeBuyQty=data.items.find(x=>x.name==='卵').qty;
 w.go('buy');$('routineList').querySelector('[data-bf-routine-buy="901"]').click();
 assert.ok($('bfDestination').querySelector('[data-qa-dest="buy"]').classList.contains('selected'));
 assert.equal(w.AtokoreQuickAdd.getTray().length,2);
 $('qaCommit').click();
 data=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(data.buys.some(x=>x.name==='牛乳'));
 assert.equal(data.items.find(x=>x.name==='卵').qty,beforeBuyQty,'shopping-list commit must not modify stock');
 dom.window.close();
});
test('buy page picker opens baby-first selection and shopping-only destination',()=>{
 const {dom,w,$}=browser();
 w.go('buy');
 assert.ok($('bfBuyPick'));
 $('bfBuyPick').click();
 assert.equal($('pg-add').classList.contains('on'),true);
 assert.ok($('bfDestination').querySelector('[data-qa-dest="buy"]').classList.contains('selected'));
 choose($,'diaper','パンパース','パンツ','M');
 $('qaCommit').click();
 const data=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(data.buys.some(x=>x.name.includes('パンパース')));
 assert.ok(!data.items.some(x=>x.name.includes('パンパース')));
 dom.window.close();
});
test('offline shell has complete v17 scripts and separate palette',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const worker=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.ok(html.indexOf('baby-kit-v17.js')<html.indexOf('quick-add.js?v=18'));
 assert.ok(html.indexOf('baby-flow-v17.js')>html.indexOf('edit-after-add.js'));
 for(const file of ['baby-kit-v17.js','baby-flow-v17.js','baby-focus-v17.css']){
  assert.match(worker,new RegExp(file.replace(/\./g,'\\.')));
 }
 assert.match(worker,/atokore-pwa-v20/);
});
