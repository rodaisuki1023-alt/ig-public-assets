const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.join(__dirname,'../atokore-live-v125');
const art=require('../atokore-live-v125/product-icons.js');
function browser(){
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://example.invalid/atokore/',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const f of ['ui.js','stability.js','baby-visuals.js','atokore-redesign.js','product-icons.js','quick-add.js'])w.eval(fs.readFileSync(path.join(base,f),'utf8'));
 return {dom,w,$:id=>w.document.getElementById(id)};
}
test('original identifiable silhouettes for individual food and household products',()=>{
 const exp={玉ねぎ:'onion',にんじん:'carrot',じゃがいも:'potato',トマト:'tomato',キャベツ:'cabbage',ブロッコリー:'broccoli',卵:'egg',鶏むね肉:'chicken',豚こま肉:'pork',牛乳:'milk',食パン:'bread',バナナ:'banana',りんご:'apple',豆腐:'tofu',納豆:'natto',ティッシュ:'tissue',トイレットペーパー:'toilet',洗濯洗剤:'detergent',食器用洗剤:'dish'};
 for(const [name,key] of Object.entries(exp)){
  assert.equal(art.resolve(name),key);
  const s=art.icon(name);
  assert.ok(s.includes('data-product-icon="'+key+'"'));
  assert.match(s,/<svg[^>]*viewBox="0 0 48 48"/);
  assert.match(s,/aria-hidden="true"/);
  assert.doesNotMatch(s,/<image\b|<script|<foreignObject|\bsrc=/i);
 }
 assert.notEqual(art.icon('玉ねぎ'),art.icon('にんじん'));
 assert.equal(art.icon('ブランド未設定の商品'),null);
 assert.ok(art.keys.length>=30);
});
test('compact quick-add uses text only while the stock list shows distinct icons',()=>{
 const {dom,w,$}=browser();w.atkOpenAdd();w.AtokoreQuickAdd.setCategory('食料品');
 assert.equal($('qaTiles').querySelectorAll('.qa-icon').length,0);
 for(const name of ['玉ねぎ','にんじん','卵']){
  const button=$('qaTiles').querySelector('[data-qa-pick="'+name+'"]');
  assert.ok(button);button.click();
 }
 assert.match($('qaTotal').textContent,/3商品/);
 $('qaBar').click();$('qaCommit').click();
 const html=$('stockList').innerHTML;
 for(const key of ['onion','carrot','egg'])assert.ok(html.includes('data-product-icon="'+key+'"'));
 const saved=JSON.parse(w.localStorage.getItem('atokoreTrialV4'));
 assert.ok(saved.items.some(x=>x.name==='玉ねぎ'));
 dom.window.close();
});
test('baby brand badge is maintained and not replaced with grocery icon',()=>{
 const {dom,w,$}=browser();w.atkOpenAdd();
 $('qaTabs').querySelector('[data-qa-cat="ベビー"]').click();
 for(const [field,value] of [['brand','マミーポコ'],['type','パンツ'],['size','M']]){
  const btn=$('qaBaby').querySelector('[data-qa-baby="'+field+'"][data-value="'+value+'"]');
  assert.ok(btn);btn.click();
 }
 $('qaBaby').querySelector('[data-qa-babyadd]').click();$('qaBar').click();$('qaCommit').click();
 assert.match($('stockList').textContent,/MamyPoko/);
 assert.equal(art.resolve('マミーポコ おむつ パンツ M'),null);
 dom.window.close();
});
test('text first contrast and touch controls meet minimum design thresholds',()=>{
 const css=fs.readFileSync(path.join(base,'compact-add.css'),'utf8');
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/min-height:53px/);assert.match(css,/min-height:44px/);
 const lum=h=>{const a=h.slice(1).match(/.{2}/g).map(v=>parseInt(v,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
 const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((a,b)=>b-a);return (x+.05)/(y+.05)};
 assert.ok(ratio('#5B4840','#FFFEFC')>=4.5);
 assert.ok(ratio('#FFFFFF','#A85647')>=4.5);
});
test('offline app includes the new glyph library before the UI and cache is bumped',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(base,'service-worker.js'),'utf8');
 assert.match(html,/src="\.\/product-icons\.js\?v=15"/);
 assert.match(html,/href="\.\/compact-add\.css\?v=15"/);
 assert.ok(html.indexOf('product-icons.js')<html.indexOf('quick-add.js'));
 assert.match(sw,/'\.\/product-icons.js'/);
 assert.match(sw,/'\.\/compact-add.css'/);
 assert.match(sw,/atokore-pwa-v43/);
});
