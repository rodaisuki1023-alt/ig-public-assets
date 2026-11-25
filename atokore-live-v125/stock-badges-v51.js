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
let open=null;
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
 if(listMode||open===id)return '<div class="atk-lv atk-lv-open" data-atk-lv="'+id+'" role="group" aria-label="'+esc(say)+'"><span class="atk-lv-src atk-lv-'+level+'">'+esc(src||label)+'</span>'+L.LEVELS.map(btn).join('')+'</div>';
 return '<div class="atk-lv" data-atk-lv="'+id+'"><button type="button" class="atk-lv-mark atk-lv-'+level+'" data-atk-lv-open aria-label="'+esc(say+'。タップで変更')+'">'+esc(label)+(src?'<small>'+esc(src)+'</small>':'')+'</button></div>';
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
 const t=e.target.closest?.('[data-atk-lv-open],[data-atk-lv-set]');if(!t)return;
 const box=t.closest('[data-atk-lv]');if(!box||!box.closest('#stockList'))return;
 e.stopPropagation();
 const id=Number(box.dataset.atkLv);
 if(t.hasAttribute('data-atk-lv-open')){open=id;decorate();doc.querySelector('[data-atk-lv="'+id+'"] [data-atk-lv-set]')?.focus();return}
 const x=list().find(i=>Number(i.id)===id);if(!x)return;
 const lv=t.dataset.atkLvSet;
 // Tapping the level that is already set removes the person's own choice (back to estimate/count).
 open=null;
 if(!UI.setLevelFor(id,x.level===lv?null:lv))decorate();
},true);
const base=root.renderStock;
if(typeof base==='function')root.renderStock=function(...args){const r=base.apply(this,args);try{decorate()}catch(err){console.error('あとこれ: 残りの目安',err)}return r};
decorate();
root.AtokoreStockBadges=Object.freeze({refresh:decorate});
})(typeof globalThis!=='undefined'?globalThis:this);
