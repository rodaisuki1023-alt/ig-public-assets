/* Atokore v51 stock list: the 3-level mark on every product, changeable from the list.
 * - 横1列: 余裕あり / そろそろ / 買う are three small buttons; one tap sets the level.
 * - 写真付き3列: a small text label on the picture (cards keep their compact height); the level is
 *   changed in 横1列 or in the product sheet (かんたん管理).
 * - The mark always says where the level comes from: 自分 (set by the person), 見積 (estimate),
 *   在庫数 (count rule) or 要確認. Text, not only colour. Nothing here changes the count (qty).
 * - A level set long ago, or 余裕あり while the count is 0, shows 要確認 instead of deciding.
 */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null,L=root.AtokoreStockLevels,UI=root.AtokoreStockLevelsUI;
if(!doc||!L||!UI)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let open=null,recent=null,recentTimer=0;
const UNDO_MS=8000;
// Comparison prototype (Muse): in 横1列, products judged 余裕あり may be shown as ONE short line
// (label + 「変える」); そろそろ／買う／要確認 keep the three one-tap buttons. Off by default and
// per device; it never replaces the current layout unless the person turns it on.
const COMPACT_KEY='atokoreStockCompactPlentyV1';
function compactOn(){try{return root.localStorage.getItem(COMPACT_KEY)==='1'}catch(_){return false}}
function list(){try{return Array.isArray(items)?items:[]}catch(_){return []}}
const SRC={manual:'自分',estimate:'見積',count:'在庫数',none:''};
function mark(x,listMode){
 const t=UI.today(),d=L.displayLevel(x,t),check=d.source==='manual'?UI.manualState(x,t):null;
 const level=d.level==='unknown'||check?'unknown':d.level,src=check?'要確認':d.level==='unknown'?'要確認':SRC[d.source]||'';
 const id=Number(x.id),name=String(x.name||'商品');
 const label=d.level==='unknown'?'確認':d.label;
 const say=name+'の残りの目安：'+label+(src?'（'+src+'）':'');
 const btn=lv=>'<button type="button" class="atk-lv-choice" data-atk-lv-set="'+lv+'" aria-pressed="'+(x.level===lv)+'" aria-label="'+esc(name+'を「'+L.LABEL[lv]+'」にする')+'">'+esc(L.LABEL[lv])+'</button>';
 if(!listMode)return '<span class="atk-lv-tag atk-lv-'+level+'" data-atk-lv="'+id+'" role="note" aria-label="'+esc(say)+'">'+esc(label)+'</span>';
 // A level just changed by mistake can be put back for a few seconds (Muse N-2).
 const undo=recent&&recent.id===id?'<button type="button" class="atk-lv-undo" data-atk-lv-undo aria-label="'+esc(name+'の目安の変更を元に戻す')+'">元に戻す</button>':'';
 if(listMode&&compactOn()&&level==='plenty'&&open!==id&&!undo)
  return '<div class="atk-lv atk-lv-compact" data-atk-lv="'+id+'"><span class="atk-lv-src atk-lv-plenty">'+esc(label+(src?'（'+src+'）':''))+'</span><button type="button" class="atk-lv-more" data-atk-lv-open aria-label="'+esc(say+'。タップで変更')+'">余裕あり ▾</button></div>';
 if(listMode||open===id)return '<div class="atk-lv atk-lv-open" data-atk-lv="'+id+'" role="group" aria-label="'+esc(say)+'"><span class="atk-lv-src atk-lv-'+level+'">'+esc(src||label)+'</span>'+L.LEVELS.map(btn).join('')+undo+'</div>';
 return '<div class="atk-lv" data-atk-lv="'+id+'"><button type="button" class="atk-lv-mark atk-lv-'+level+'" data-atk-lv-open aria-label="'+esc(say+'。タップで変更')+'">'+esc(label)+(src?'<small>'+esc(src)+'</small>':'')+'</button></div>';
}
// The prototype switch lives on the お試し page (not in the stock list): it is a comparison, and
// it was not adopted as default (it costs one more tap for 余裕あり products; see docs).
function toggleHTML(){
 const page=doc.getElementById('pg-premium');if(!page)return;
 let t=doc.getElementById('atkCompactPlenty');
 if(!t){t=doc.createElement('label');t.id='atkCompactPlenty';t.className='atk-compact-toggle';
  t.innerHTML='<input type="checkbox" data-atk-compact> 試作：横1列で「余裕あり」の商品を短く表示する（変更は2タップになります）';
  const anchor=doc.getElementById('atkBuildInfo');if(anchor)anchor.before(t);else page.append(t)}
 t.querySelector('input').checked=compactOn();
}
function decorate(){
 const listMode=doc.getElementById('pg-stock')?.classList.contains('atk-stock-list-mode');
 const data=new Map(list().map(x=>[String(x.id),x]));
 for(const row of doc.querySelectorAll('#stockList [data-stock-id]')){
  const x=data.get(row.dataset.stockId);row.querySelectorAll(':scope > .atk-lv, .atk-lv-tag').forEach(n=>n.remove());if(!x)continue;
  const w=doc.createElement('div');w.innerHTML=mark(x,listMode);
  const art=listMode?null:row.querySelector('.atk-row-brand');
  if(art)art.append(w.firstElementChild);else row.append(w.firstElementChild);
 }
}
doc.addEventListener('click',e=>{
 const t=e.target.closest?.('[data-atk-lv-open],[data-atk-lv-set],[data-atk-lv-undo]');if(!t)return;
 const box=t.closest('[data-atk-lv]');if(!box||!box.closest('#stockList'))return;
 e.stopPropagation();
 const id=Number(box.dataset.atkLv);
 if(t.hasAttribute('data-atk-lv-open')){open=id;decorate();doc.querySelector('[data-atk-lv="'+id+'"] [data-atk-lv-set]')?.focus();return}
 const x=list().find(i=>Number(i.id)===id);if(!x)return;
 if(t.hasAttribute('data-atk-lv-undo')){
  const r=recent;recent=null;clearTimeout(recentTimer);
  if(!r||r.id!==id||x.level!==r.now){decorate();return}   // changed again since: nothing to put back
  if(!UI.restoreLevel(id,r.prev,r.prevAt))decorate();
  return;
 }
 const lv=t.dataset.atkLvSet;
 const prev=L.LEVELS.includes(x.level)?x.level:null,next=x.level===lv?null:lv;
 // Tapping the level that is already set removes the person's own choice (back to estimate/count).
 open=null;
 clearTimeout(recentTimer);recent={id,prev,prevAt:x.levelAt,now:next||undefined};
 recentTimer=setTimeout(()=>{recent=null;decorate()},UNDO_MS);
 if(!UI.setLevelFor(id,next)){recent=null;decorate()}
},true);
doc.addEventListener('change',e=>{
 if(!e.target.matches?.('[data-atk-compact]'))return;
 try{if(e.target.checked)root.localStorage.setItem(COMPACT_KEY,'1');else root.localStorage.removeItem(COMPACT_KEY)}catch(_){}
 open=null;decorate();
});
const base=root.renderStock;
if(typeof base==='function')root.renderStock=function(...args){const r=base.apply(this,args);try{decorate()}catch(err){console.error('あとこれ: 残りの目安',err)}return r};
toggleHTML();decorate();
root.AtokoreStockBadges=Object.freeze({refresh:decorate});
})(typeof globalThis!=='undefined'?globalThis:this);
