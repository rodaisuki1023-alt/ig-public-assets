/* Atokore original baby visuals. No vendor logos, ads, API, external assets or storage mutation. */
(function(root){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BRANDS=['パンパース','グーン','ムーニー','メリーズ','明治','和光堂','森永','ビーンスターク','アイクレオ'];
function identify(item){
 const name=String(item?.name||'').normalize('NFKC'),cat=String(item?.cat||'');
 if(cat!=='ベビー'&&!/オムツ|おむつ|パンパース|グーン|ムーニー|メリーズ|ミルク|おしりふき/.test(name))return null;
 const kind=/おしりふき|お尻ふき/.test(name)?'wipes':/ミルク|ほほえみ|はいはい|すこやか|アイクレオ/.test(name)?'milk':/オムツ|おむつ|パンツ|テープ|パンパース|グーン|ムーニー|メリーズ/.test(name)?'diaper':'other';
 const brand=BRANDS.find(b=>name.includes(b))||'';
 const type=kind==='diaper'?(/パンツ/.test(name)?'パンツ':/テープ/.test(name)?'テープ':''):kind==='milk'?(/液体/.test(name)?'液体':/キューブ/.test(name)?'キューブ':/スティック/.test(name)?'スティック':/缶/.test(name)?'缶':''):'';
 const sizeMatch=kind==='diaper'?name.match(/新生児|ビッグより大きい|ビッグ|BIG|(?:オムツ|おむつ|パンツ|テープ|サイズ|[\s・／/])\s*([SML])(?=$|[\s・／/]|[0-9])/i):null;
 let size=sizeMatch?(sizeMatch[1]||sizeMatch[0]).replace(/^(オムツ|おむつ|パンツ|テープ|サイズ)/,'').trim().toUpperCase():'';
 if(size==='BIG')size='ビッグ';
 const amount=name.match(/([0-9]{1,4})\s*(枚|g|ml|mL|本|個)/i);
 return {kind,brand,type,size,amount:amount?amount[1]+amount[2]:''};
}
function svg(kind){
 const [bg,line]=kind==='diaper'?['#f9e5dd','#b86f5a']:kind==='milk'?['#e7e1f8','#7867a6']:kind==='wipes'?['#dff2e9','#4a9279']:['#f8ebd4','#af8a52'];
 const shape=kind==='diaper'
 ?'<path d="M20 29 Q32 34 44 29 L47 46 Q32 55 17 46 Z" fill="white" stroke="'+line+'" stroke-width="2"/><path d="M20 29 L25 41 L17 46 M44 29 L39 41 L47 46 M27 43 Q32 47 37 43" fill="none" stroke="'+line+'" stroke-width="1.7"/>'
 :kind==='milk'
 ?'<rect x="22" y="17" width="20" height="36" rx="6" fill="white" stroke="'+line+'" stroke-width="2"/><path d="M22 25 Q32 21 42 25" stroke="'+line+'" stroke-width="2"/><rect x="26" y="33" width="12" height="12" rx="4" fill="'+bg+'" stroke="'+line+'"/>'
 :kind==='wipes'
 ?'<rect x="13" y="29" width="38" height="23" rx="7" fill="white" stroke="'+line+'" stroke-width="2"/><rect x="22" y="33" width="20" height="7" rx="3.5" fill="'+bg+'" stroke="'+line+'"/><path d="M26 29 Q23 17 32 13 Q41 17 38 29" fill="white" stroke="'+line+'" stroke-width="1.7"/>'
 :'<rect x="18" y="17" width="28" height="36" rx="7" fill="white" stroke="'+line+'" stroke-width="2"/><path d="M25 35 H39 M32 28 V42" stroke="'+line+'" stroke-width="2"/>';
 return '<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="17" fill="'+bg+'"/>'+shape+'</svg>';
}
function icon(i){return '<span class="bv-icon">'+svg(i.kind)+'</span>'}
function badges(i){return '<span class="bv-tags">'+[i.brand,i.type,i.size,i.amount].filter(Boolean).map(s=>'<span class="bv-badge">'+esc(s)+'</span>').join('')+'</span>'}
function stock(){try{return Array.isArray(items)?items:[]}catch(e){return []}}
function buy(){try{return Array.isArray(buys)?buys:[]}catch(e){return []}}
function inject(row,item){
 if(!row||!item||row.querySelector('.bv-icon'))return;
 const i=identify(item),grow=row.querySelector('.grow'),name=row.querySelector('.name');
 if(!i||!grow||!name)return;
 grow.insertAdjacentHTML('beforebegin',icon(i));name.insertAdjacentHTML('afterend',badges(i));
}
function renderStock(){const records=stock();document.querySelectorAll('#stockList [data-stock-id]').forEach(r=>inject(r,records.find(x=>String(x.id)===r.dataset.stockId)))}
function renderBuy(){const records=buy();document.querySelectorAll('#buyList [data-buy-id]').forEach(r=>inject(r,records.find(x=>String(x.id)===r.dataset.buyId)))}
function renderCatalog(){
 document.querySelectorAll('#catalog button.product').forEach(r=>{
  if(r.querySelector('.bv-icon'))return;
  const first=r.firstChild;if(!first||first.nodeType!==3)return;
  const i=identify({name:first.textContent,cat:document.getElementById('addCat')?.value});
  if(i){r.insertAdjacentHTML('afterbegin',icon(i));r.insertAdjacentHTML('beforeend',badges(i))}
 });
}
const css=[
'.bv-icon{display:grid;place-items:center;flex:0 0 55px;width:55px;height:55px}',
'#stockList .stableStockRow,#buyList .stableBuyRow{gap:6px}',
'.bv-tags{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}',
'.bv-badge{background:#f7e9e2;color:#825640;border-radius:7px;padding:3px 6px;border:1px solid #efddd4;font-size:10px;font-weight:850;line-height:1.25}',
'#catalog .bv-icon{display:block;margin:0 auto 5px}',
'#catalog .bv-icon svg{width:44px;height:44px}',
'#catalog .bv-tags{justify-content:center}',
'#catalog .bv-badge{font-size:9px;padding:2px 4px}',
'.bv-wizard{background:#fffaf6;border:1px solid #e8d6cd;border-radius:17px;padding:13px;margin:14px 0}',
'.bv-wizard summary{font-weight:850;color:#9a5c43;cursor:pointer}',
'.bv-wizard p{font-size:12px;line-height:1.6;color:#75675f}',
'.bv-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
'.bv-fields label{font-size:12px;color:#62554e;font-weight:750}',
'.bv-fields label.wide{grid-column:span 2}',
'.bv-fields select,.bv-fields input{display:block;width:100%;min-width:0;margin-top:4px;border:1px solid #dac9be;border-radius:10px;padding:11px 8px;font-size:16px;background:#fff}',
'.bv-wizard button{display:block;margin-top:11px;width:100%;min-height:44px;background:#b96f56;color:#fff;font-weight:850;border:0;border-radius:12px}',
'#bvNotice{font-size:11px;line-height:1.6;color:#4d715c;margin-top:7px}',
'@media(max-width:365px){#stockList .bv-icon,#buyList .bv-icon{flex:0 0 43px;width:43px;height:43px}#stockList .bv-icon svg,#buyList .bv-icon svg{width:43px;height:43px}}'
].join('\n');
function wizard(){
 const cat=document.getElementById('addCat'),name=document.getElementById('addName');
 if(!cat||!name)return;
 let box=document.getElementById('bvWizard');
 if(box){box.hidden=cat.value!=='ベビー';return}
 box=document.createElement('details');box.id='bvWizard';box.className='bv-wizard';
 box.innerHTML='<summary>🧷 メーカー・サイズを選んで追加</summary><p>実際のパッケージを見て入力。ロゴや公式商品写真は使用しません。</p><div class="bv-fields">'+
 '<label class="wide">メーカー<input id="bvBrand" list="bvBrandList" placeholder="例：パンパース"><datalist id="bvBrandList">'+BRANDS.map(x=>'<option value="'+x+'">').join('')+'</datalist></label>'+
 '<label class="wide">シリーズ（任意）<input id="bvSeries" placeholder="例：さらさらケア"></label>'+
 '<label>品目<select id="bvKind"><option value="diaper">おむつ</option><option value="milk">粉ミルク</option><option value="wipes">おしりふき</option></select></label>'+
 '<label>種類<select id="bvType"></select></label>'+
 '<label id="bvSizeWrap">サイズ<select id="bvSize"><option value="">選択</option><option>新生児</option><option>S</option><option>M</option><option>L</option><option>ビッグ</option><option>ビッグより大きい</option></select></label>'+
 '<label>1包装の内容量<input type="number" min="1" max="9999" step="1" id="bvAmount" placeholder="例：60"></label>'+
 '</div><button type="button" id="bvApply">商品名に反映</button><div id="bvNotice" aria-live="polite">下の数量を入力して「登録する」を押すと在庫に追加できます。</div>';
 name.closest('.field')?.insertAdjacentElement('beforebegin',box);
 cat.addEventListener('change',()=>{box.hidden=cat.value!=='ベビー'});
 box.hidden=cat.value!=='ベビー';
 const kind=box.querySelector('#bvKind'),type=box.querySelector('#bvType');
 function refresh(){
  const options=kind.value==='diaper'?['パンツ','テープ']:kind.value==='milk'?['缶','キューブ','スティック','液体']:['シート'];
  type.innerHTML=options.map(s=>'<option>'+s+'</option>').join('');
  box.querySelector('#bvSizeWrap').hidden=kind.value!=='diaper';
 }
 kind.addEventListener('change',refresh);refresh();
 box.querySelector('#bvApply').addEventListener('click',()=>{
  const brand=box.querySelector('#bvBrand').value.trim(),series=box.querySelector('#bvSeries').value.trim(),sz=box.querySelector('#bvSize').value;
  const qty=Number(box.querySelector('#bvAmount').value);
  if(!brand||!Number.isSafeInteger(qty)||qty<1||qty>9999||(kind.value==='diaper'&&!sz)){
    box.querySelector('#bvNotice').textContent='メーカー・内容量と、おむつの場合はサイズを入力してください。';return;
  }
  const unit=kind.value==='milk'?(type.value==='液体'?'mL':type.value==='缶'?'g':'個'):'枚';
  const title=[brand,series,kind.value==='diaper'?'おむつ':kind.value==='milk'?'粉ミルク':'おしりふき',type.value,kind.value==='diaper'?sz:'',qty+unit].filter(Boolean).join(' ');
  name.value=title;
  window.onNameInput?.();
  const stockUnit=document.getElementById('addUnit');
  if(stockUnit)stockUnit.value=kind.value==='diaper'?'袋':kind.value==='milk'?'個':'パック';
  box.querySelector('#bvNotice').textContent='商品名を反映：'+title+'。下の「登録する」で保存してください。';
 });
}
function install(){
 const style=document.createElement('style');style.id='atokoreBabyVisualStyle';style.textContent=css;document.head.appendChild(style);
 for(const [key,decorate] of [['renderStock',renderStock],['renderBuy',renderBuy],['renderCatalog',renderCatalog]]){
  const original=window[key];if(typeof original==='function')window[key]=function(...a){const r=original.apply(this,a);decorate();return r};
 }
 wizard();renderStock();renderBuy();renderCatalog();
}
const api=Object.freeze({identify,svg,esc});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreBabyVisuals=api;
if(typeof document!=='undefined'&&typeof window!=='undefined')install();
})(typeof globalThis!=='undefined'?globalThis:this);
