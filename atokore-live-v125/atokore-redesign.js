/* Atokore Peach v13: visual enhancement only. Keep legacy stock persistence and actions intact. */
(function(root){
'use strict';
const $=id=>typeof document==='undefined'?null:document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BRANDS=[
 {key:'pampers',jp:'パンパース',en:'Pampers',re:/パンパース|pampers/i,bg:'#d0ebe1',fg:'#285d52',lines:['さらさらケア','肌へのいちばん','おやすみパンツ','超吸収エアリー']},
 {key:'goon',jp:'グーン',en:'GOO.N',re:/グーン|goo[\s.\-]?n/i,bg:'#e5dcf5',fg:'#56477e',lines:['モレ0へ','ぐんぐん吸収','12時間ぐんぐん吸収','ナイト']},
 {key:'mamypoko',jp:'マミーポコ',en:'MamyPoko',re:/マミーポコ|mamy\s?poko/i,bg:'#ffedc2',fg:'#795322',lines:['マミーポコパンツ','夜用パンツ']},
 {key:'moony',jp:'ムーニー',en:'moony',re:/ムーニー|ムーニーマン|moony/i,bg:'#dce8ff',fg:'#385a92',lines:['ムーニー','ムーニーマン','低刺激であんしん','オヤスミマン']},
 {key:'merries',jp:'メリーズ',en:'Merries',re:/メリーズ|merries/i,bg:'#f9dee8',fg:'#923e63',lines:['ずっと肌さらエアスルー','ファーストプレミアム','ぐっすりパンツ']},
 {key:'meiji',jp:'明治',en:'明治',re:/明治|ほほえみ|ステップ/,bg:'#fce1db',fg:'#8f4a3c',lines:['ほほえみ','ステップ']},
 {key:'morinaga',jp:'森永',en:'森永',re:/森永|はぐくみ|チルミル/,bg:'#e2eddb',fg:'#546f46',lines:['はぐくみ','チルミル']},
 {key:'wakodo',jp:'和光堂',en:'和光堂',re:/和光堂|はいはい|ぐんぐん/,bg:'#e5eeec',fg:'#436760',lines:['はいはい','ぐんぐん']}
];
function describe(item){
 const raw=String(item?.name||'').normalize('NFKC').trim();
 const brand=BRANDS.find(b=>b.re.test(raw))||null;
 const match=raw.match(/(?:^|[\s・／\/()])(?:サイズ)?(ビッグより大きい|ビッグ|BIG|XXL|XL|新生児|[SML])(?=$|[\s・／\/()0-9])/i)||raw.match(/オムツ([SML])$/i);
 const size=match?(match[1]||'').toUpperCase().replace('BIG','ビッグ'):'';
 const type=/パンツ/.test(raw)?'パンツ':/テープ/.test(raw)?'テープ':/液体/.test(raw)?'液体':/キューブ/.test(raw)?'キューブ':/スティック/.test(raw)?'スティック':/缶/.test(raw)?'缶':'';
 let line=brand?raw.replace(brand.re,'').trim():raw;
 line=line.replace(/[0-9]{1,4}\s*(?:枚|g|mL|ml)(?=$|[\s・／\/()])/gi,' ');
 line=line.replace(/液体ミルク|粉ミルク/g,' ');
  if(type)line=line.replace(type,' ');
 if(size)line=line.replace(size,' ');
 line=line.replace(/おむつ|オムツ|粉ミルク/g,' ').replace(/\s+/g,' ').trim();
 // Without a series, name the product kind (おむつ・粉ミルク …) instead of the vague 「いつもの商品」.
  if(!line)line=brand?(/おしりふき/.test(raw)?'おしりふき':/液体ミルク|液体/.test(raw)?'液体ミルク':/ミルク/.test(raw)?'粉ミルク':/おむつ|オムツ|パンツ|テープ/.test(raw)?'おむつ':raw):raw;
 return {raw,brand,line,type,size,cat:item?.cat||''};
}
function stock(){try{return Array.isArray(items)?items:[]}catch(e){return []}}
function shopping(){try{return Array.isArray(buys)?buys:[]}catch(e){return []}}
// 要補充: at or below the product's own reorder line (minQty), or 1 when none is set.
const reorderAt=x=>{const m=x?.minQty;return m===''||m==null||!Number.isSafeInteger(Number(m))?1:Number(m)};
const low=x=>Number(x.qty)<=reorderAt(x);
root.atokoreIsLow=low;root.atokoreReorderAt=reorderAt;
function expSoon(x){if(!x.exp)return false;const date=new Date(x.exp+'T00:00:00');const now=new Date();now.setHours(0,0,0,0);return Math.round((date-now)/86400000)<=3}
function brandHtml(b){return b?'<span class="atk-brand" style="--brand-bg:'+b.bg+';--brand-fg:'+b.fg+'">'+esc(b.en)+'</span>':'<span class="atk-brand atk-brand-generic">ストック</span>'}
function itemCard(item,attention){
 const d=describe(item),id=Number(item.id),details=[d.type,d.size?d.size+(d.size.length===1?'サイズ':''):''].filter(Boolean).join('・');
 const act=Number.isSafeInteger(id)?'data-atk-open="'+id+'"':'';
 return '<button class="atk-item-card" type="button" '+act+'><span class="atk-item-id">'+brandHtml(d.brand)+'</span><span class="atk-item-copy"><strong>'+esc(d.line)+'</strong><small>'+esc(details||item.cat||'')+'</small></span><span class="atk-count '+(low(item)?'atk-count-low':'')+'">'+(attention?'残り ':'')+esc(item.qty)+' '+esc(item.unit||'個')+'</span><span class="atk-chevron">›</span></button>';
}
function homeHTML(){
 return '<div class="atk-home">'+
 '<div class="atk-welcome" id="homeHero"><div><span class="atk-eyebrow">わが家のストック</span><h2>買い忘れを、なくそう。</h2><p>買うものも、残りの数も。家族でひと目に。</p></div><svg class="atk-family-art" viewBox="0 0 115 88" aria-hidden="true"><circle cx="31" cy="31" r="14" fill="#c79279"/><circle cx="79" cy="29" r="13" fill="#bd856c"/><circle cx="56" cy="54" r="10" fill="#eec7a6"/><path d="M6 79 Q12 51 31 50 Q47 51 46 79" fill="#c8b4aa"/><path d="M67 79 Q66 51 79 49 Q97 49 107 79" fill="#87978e"/><path d="M41 85 Q43 64 56 63 Q72 63 75 85" fill="#f4d6c5"/></svg></div>'+
 '<div class="atk-summary"><button class="atk-metric atk-metric-peach" data-atk-nav="stock"><span>◉ 要補充</span><b id="atkLowCount">0</b></button><button class="atk-metric atk-metric-lilac" data-atk-nav="buy"><span>▣ 買い物中</span><b id="atkBuyCount">0</b></button><button class="atk-metric atk-metric-sage" data-atk-nav="stock"><span>◷ 期限近い</span><b id="atkExpiryCount">0</b></button></div>'+
 '<div class="atk-actions"><button data-atk-add class="atk-action atk-action-primary"><span>＋</span>ストック追加</button><button data-atk-receipt class="atk-action atk-action-peach"><span>▤</span>レシートで追加</button><button data-atk-nav="buy" class="atk-action atk-action-sage"><span>🛒</span>買い物リスト</button></div>'+
 '<div class="atk-section-head"><h3>今日やること</h3><button data-atk-nav="stock">すべて見る ›</button></div><div id="atkTasks" class="atk-tasks"></div>'+
 '<div class="atk-section-head"><h3>いつものストック</h3><button data-atk-nav="stock">一覧を見る ›</button></div><div id="atkRecent" class="atk-tasks"></div></div>';
}
function renderHome(){
 if(!$('atkLowCount'))return;
 const a=stock(),needs=a.filter(low),b=shopping(),expiry=a.filter(expSoon);
 $('atkLowCount').textContent=needs.length;$('atkBuyCount').textContent=b.length;$('atkExpiryCount').textContent=expiry.length;
 const tasks=[...needs,...expiry.filter(x=>!needs.some(y=>y.id===x.id))].slice(0,3);
 $('atkTasks').innerHTML=tasks.length?tasks.map(x=>itemCard(x,true)).join(''):'<div class="atk-empty">急いで補充する商品はありません。<br>いつものストックを登録しておくと、ここに表示されます。</div>';
 const normal=a.filter(x=>!tasks.some(y=>y.id===x.id)).slice(0,3);
 $('atkRecent').innerHTML=normal.length?normal.map(x=>itemCard(x,false)).join(''):'<div class="atk-empty">在庫を登録すると、ここから確認できます。</div>';
}
function rowDecorate(row,item){
 if(!row||!item)return;const d=describe(item);
 row.querySelectorAll('.bv-icon,.bv-tags,.catMark,.stableCat,.atk-row-brand').forEach(node=>node.remove());
 const grow=row.querySelector('.grow'),name=grow?.querySelector('.name'),meta=grow?.querySelector('.meta');
 if(!grow||!name)return;
 const badge=document.createElement('span');badge.className='atk-row-brand';
 if(d.brand){badge.style.background=d.brand.bg;badge.style.color=d.brand.fg;badge.textContent=d.brand.en;badge.title=d.brand.jp}
 else{badge.classList.add('atk-row-generic');badge.textContent=(item.cat||'商品').slice(0,4)}
 grow.insertAdjacentElement('beforebegin',badge);
 name.textContent=d.line;name.title=String(item.name||'');
 if(meta)meta.textContent=[d.type,d.size?d.size+'サイズ':'',item.place||''].filter(Boolean).join(' ・ ')||item.cat||'';
 row.classList.add('atk-v2-row');row.classList.toggle('atk-low',low(item));
}
function decorateStock(){
 const a=stock();document.querySelectorAll('#stockList [data-stock-id]').forEach(row=>rowDecorate(row,a.find(x=>String(x.id)===row.dataset.stockId)));
}
function decorateShopping(){
 const a=shopping();document.querySelectorAll('#buyList [data-buy-id]').forEach(row=>rowDecorate(row,a.find(x=>String(x.id)===row.dataset.buyId)));
}
function initHome(){const pg=$('pg-home');if(pg)pg.innerHTML=homeHTML()}
function initStock(){
 const pg=$('pg-stock'),search=$('stockSearch');if(!pg||!search)return;
 const h=document.createElement('div');h.className='atk-page-title';h.innerHTML='<h2>ストック</h2><button type="button" data-atk-add aria-label="ストックを追加">＋ ストック追加</button>';pg.prepend(h);
 search.placeholder='ブランド名・商品名で検索';
 const hint=document.createElement('div');hint.className='atk-stock-hint';hint.textContent='商品をタップして詳細を確認。－／＋で在庫を増減できます。';
 $('catChips')?.insertAdjacentElement('afterend',hint);
}
function initNavigation(){
 const top=document.querySelector('.top');if(top)top.innerHTML='<div class="atk-top-title"><h1>あとこれ</h1><span>わが家のストック</span></div><div class="atk-top-tools"><button data-atk-notice aria-label="お知らせ">♧</button><button data-atk-nav="premium" aria-label="マイページ">●</button></div>';
 const labels={home:['⌂','ホーム'],stock:['▣','ストック'],buy:['🛒','買い物'],premium:['♙','マイページ']};
 document.querySelectorAll('.tabs .tab').forEach(t=>{
  if(t.dataset.p==='add'){t.style.display='none';return}
  const x=labels[t.dataset.p];if(x){t.innerHTML='<b>'+x[0]+'</b>'+x[1];t.setAttribute('aria-label',x[1])}
 });
 const premium=$('pg-premium');if(premium)premium.querySelector('.section').textContent='マイページ';
 const buyTitle=$('pg-buy')?.querySelector('.section');if(buyTitle)buyTitle.textContent='買い物リスト';
}
let manual=false;
function initAdd(){
 const pg=$('pg-add'),cat=$('addCat'),name=$('addName');if(!pg||!cat||!name)return;
 pg.classList.add('atk-add-page');
 const h=document.createElement('div');h.className='atk-page-title';h.innerHTML='<h2>ストック追加</h2><button data-atk-nav="home" aria-label="閉じる">×</button>';pg.prepend(h);
 name.closest('.field')?.classList.add('atk-original-name');
 $('catalog')?.classList.add('atk-catalog');
 const panel=document.createElement('div');panel.id='atkGuided';panel.className='atk-guided-panel';
 panel.innerHTML='<div class="atk-guided-heading"><strong>いつものベビー用品を登録</strong><span>ブランド・種類・サイズを選択</span></div>'+
 '<label>商品カテゴリ<select id="atkKind"><option value="diaper">おむつ</option><option value="milk">粉ミルク</option><option value="wipes">おしりふき</option></select></label>'+
 '<label>ブランド<select id="atkBrand"><option value="">選択してください</option></select></label>'+
 '<label>シリーズ<select id="atkSeries"><option value="">指定なし</option></select></label>'+
 '<div class="atk-form-pair"><label>種類<select id="atkType"></select></label><label id="atkSizeLabel">サイズ<select id="atkSize"><option value="">選択してください</option><option>新生児</option><option>S</option><option>M</option><option>L</option><option>ビッグ</option><option>ビッグより大きい</option></select></label></div>'+
 '<div class="atk-product-preview"><span class="atk-preview-badge" id="atkPreviewBadge">ブランド</span><span><b id="atkPreviewLine">シリーズを選択</b><small id="atkPreviewDetail">種類・サイズ</small></span></div>'+
 '<details class="atk-optional"><summary>包装の内容量も記録（任意）</summary><label>1包装の枚数・内容量<input id="atkPackCount" type="number" min="1" step="1" inputmode="numeric" placeholder="例：60"></label><p>入り数は一覧に表示しません。包装の違いを識別するために使います。</p></details>'+
 '<button id="atkManualToggle" class="atk-manual-toggle" type="button">自由入力に切り替える</button>';
 cat.closest('.field')?.insertAdjacentElement('afterend',panel);
 const saveBtn=pg.querySelector('button[onclick="registerItem()"]');
 if(saveBtn){saveBtn.classList.add('atk-submit');saveBtn.textContent='この内容で登録';saveBtn.setAttribute('onclick','atkSubmitItem()')}
 function changeKind(){
  const kind=$('atkKind').value;
  const candidates=kind==='milk'?BRANDS.slice(5):kind==='wipes'?BRANDS:BRANDS.slice(0,5);
  $('atkBrand').innerHTML='<option value="">ブランドを選択</option>'+candidates.map(b=>'<option value="'+b.key+'">'+esc(b.jp)+'</option>').join('');
  $('atkType').innerHTML=(kind==='diaper'?['パンツ','テープ']:kind==='milk'?['缶','キューブ','スティック','液体']:['シート']).map(a=>'<option>'+a+'</option>').join('');
  $('atkSizeLabel').hidden=kind!=='diaper';
  changeBrand();
 }
 function changeBrand(){
  const b=BRANDS.find(x=>x.key===$('atkBrand').value);
  $('atkSeries').innerHTML='<option value="">指定なし</option>'+(b?.lines||[]).map(s=>'<option>'+esc(s)+'</option>').join('');
  sync();
 }
 function sync(){
  const kind=$('atkKind').value,b=BRANDS.find(x=>x.key===$('atkBrand').value);
  const line=$('atkSeries').value,type=$('atkType').value,size=$('atkSize').value;
  const badge=$('atkPreviewBadge');badge.textContent=b?.en||'ブランド';badge.style.background=b?.bg||'#eee6e0';badge.style.color=b?.fg||'#765e52';
  $('atkPreviewLine').textContent=line||'シリーズ未指定';$('atkPreviewDetail').textContent=[type,kind==='diaper'?(size?size+'サイズ':'サイズを選択'):''].filter(Boolean).join('・');
  if(!b||(kind==='diaper'&&!size)){name.value='';return}
  const unit=kind==='milk'?(type==='液体'?'mL':type==='缶'?'g':'個'):'枚';
  const n=Number($('atkPackCount').value)||0;
  name.value=[b.jp,line,kind==='diaper'?'おむつ':kind==='milk'?(type==='液体'?'液体ミルク':'粉ミルク'):'おしりふき',type,kind==='diaper'?size:'',n>0?n+unit:''].filter(Boolean).join(' ');
  $('addUnit').value=kind==='diaper'?'袋':kind==='milk'?'個':'パック';
 }
 $('atkKind').addEventListener('change',changeKind);
 $('atkBrand').addEventListener('change',changeBrand);
 ['atkSeries','atkType','atkSize','atkPackCount'].forEach(id=>$(id).addEventListener('change',sync));
 $('atkPackCount').addEventListener('input',sync);
 $('atkManualToggle').addEventListener('click',()=>{
  manual=!manual;pg.classList.toggle('atk-add-manual',manual);
  $('atkManualToggle').textContent=manual?'メーカー・サイズ選択に戻る':'自由入力に切り替える';
  if(!manual)sync();
 });
 cat.addEventListener('change',()=>{pg.classList.toggle('atk-not-baby',cat.value!=='ベビー');if(cat.value==='ベビー'&&!manual)sync()});
 root.atkSubmitItem=function(){
  if(cat.value==='ベビー'&&!manual){sync();if(!name.value.trim()){alert('ブランドとサイズ（おむつの場合）を選択してください');return}}
  root.registerItem();
 };
 root.atkOpenAdd=function(){
  cat.value='ベビー';manual=false;pg.classList.remove('atk-add-manual','atk-not-baby');changeKind();
  root.go('add');
 };
 changeKind();pg.classList.toggle('atk-not-baby',cat.value!=='ベビー');
}
function showDetail(id){
 const x=stock().find(v=>Number(v.id)===Number(id));if(!x)return;
 const d=describe(x),safeId=Number(x.id);
 if(!Number.isSafeInteger(safeId))return;
 const inner='<button class="close" onclick="closeM()">閉じる</button><div class="atk-detail-head" data-atk-detail-id="'+safeId+'">'+brandHtml(d.brand)+'<h2>'+esc(d.line)+'</h2><p>'+esc([d.type,d.size].filter(Boolean).join('・')||x.name)+'</p></div>'+
 '<div class="atk-detail-qty"><b>現在の在庫</b><span>'+esc(x.qty)+' '+esc(x.unit||'個')+'</span></div>'+
 '<div class="atk-detail-actions"><button onclick="adj('+safeId+',-1);atkShowDetail('+safeId+')">－ 減らす</button><button onclick="adj('+safeId+',1);atkShowDetail('+safeId+')">＋ 増やす</button></div>'+
 '<button type="button" class="atk-edit-open" onclick="atokoreEditStock('+safeId+')">✎ 商品情報を編集する</button>'+
 '<button class="btn atk-detail-cart" onclick="addStockOneToBuyV125H('+safeId+');closeM()">買い物リストへ追加</button>'+
 '<button class="atk-detail-delete" onclick="closeM();delItem('+safeId+')">この商品を削除</button>';
 root.openM?.(inner);
}
function events(){
 document.addEventListener('click',e=>{
  const t=e.target.closest?.('[data-atk-nav],[data-atk-add],[data-atk-receipt],[data-atk-notice],[data-atk-open]');
  if(t){
   if(t.dataset.atkNav){root.go(t.dataset.atkNav);return}
   if(t.hasAttribute('data-atk-add')){root.atkOpenAdd();return}
   if(t.hasAttribute('data-atk-receipt')){root.showPremium('receipt');return}
   if(t.hasAttribute('data-atk-open')){showDetail(t.dataset.atkOpen);return}
   if(t.hasAttribute('data-atk-notice')){
    const count=stock().filter(low).length;
    root.openM?.('<button class="close" onclick="closeM()">閉じる</button><h2>お知らせ</h2><p>補充の確認が必要な商品：'+count+'件</p><button class="btn" onclick="closeM();go(\'stock\')">ストックを見る</button>');
    return;
   }
  }
  const row=e.target.closest?.('#stockList [data-stock-id]');
  if(row&&!e.target.closest('button,input,a,select,textarea')&&!document.querySelector('#stockBulkActions:not(.hide)'))showDetail(row.dataset.stockId);
 });
}
function install(){
 document.body.classList.add('atk-v13');
 initHome();initNavigation();initStock();initAdd();events();
 const oldStock=root.renderStock,oldBuy=root.renderBuy,oldGo=root.go;
 if(typeof oldStock==='function')root.renderStock=function(...args){const result=oldStock.apply(this,args);decorateStock();return result};
 if(typeof oldBuy==='function')root.renderBuy=function(...args){const result=oldBuy.apply(this,args);decorateShopping();return result};
 root.renderHome=renderHome;
 if(typeof oldGo==='function')root.go=function(page){const result=oldGo.call(this,page);return result};
 root.atkShowDetail=showDetail;
 root.render?.();
}
const api=Object.freeze({describe,esc,low});
root.AtokorePeachUI=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof document!=='undefined'&&typeof window!=='undefined')install();
})(typeof globalThis!=='undefined'?globalThis:this);
