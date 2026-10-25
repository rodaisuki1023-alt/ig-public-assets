/* Atokore W2 item 5/9 on the stock screen: the filters in effect are always shown with a way to
 * clear each one or all; when nothing matches, the filters stay and the screen explains why, in
 * this order: (1) the filters are the cause -> clear them, (2) "もしかして" similar registered
 * names, (3) add the typed words as they are (carried to the add screen; saved only by its final
 * button). Display only: stock data is never changed here.
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
if(!doc)return;
const $=id=>doc.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stockItems(){try{return Array.isArray(items)?items:[]}catch(_){return []}}
function query(){return $('stockSearch')?.value||''}
function conditions(){
 const f=root.AtokoreBabyFlow?.stockFilters?.()||{category:'すべて'},out=[];
 if(f.category&&f.category!=='すべて')out.push({kind:'category',label:'カテゴリー：'+f.category});
 if(f.group)out.push({kind:'group',label:'種類：'+f.group.label});
 if(f.foodMonth)out.push({kind:'foodMonth',label:'月齢：'+(f.foodMonth==='unknown'?'月齢不明':f.foodMonth+'か月')});
 if(f.foodSeries)out.push({kind:'foodSeries',label:'シリーズ：'+f.foodSeries});
 if(query().trim())out.push({kind:'search',label:'検索：「'+query().trim()+'」'});
 return out;
}
function clear(kind){
 if(kind==='search'||kind==='all'){const input=$('stockSearch');if(input)input.value=''}
 if(kind==='search'){root.renderStock?.();return}
 root.AtokoreBabyFlow?.clearStockFilters?.(kind==='all'?'all':kind);
}
function renderBar(){
 const list=$('stockList');if(!list)return;
 let bar=$('atkStockConditions');
 const list_=conditions();
 if(!list_.length){bar?.remove();return}
 if(!bar){bar=doc.createElement('div');bar.id='atkStockConditions';bar.className='atk-conditions';bar.setAttribute('role','group');bar.setAttribute('aria-label','選択中の条件')}
 if(bar.nextElementSibling!==list)list.before(bar);
 bar.innerHTML='<span class="atk-conditions-title">条件</span>'+list_.map(c=>'<button type="button" class="atk-condition" data-atk-clear="'+c.kind+'" aria-label="'+esc(c.label)+'を解除">'+esc(c.label)+' <span aria-hidden="true">✕</span></button>').join('')+
  (list_.length>1?'<button type="button" class="atk-condition-all" data-atk-clear="all">すべて解除</button>':'');
}
function renderEmpty(){
 const list=$('stockList'),existing=list?.querySelector(':scope > .empty');if(!existing||existing.classList.contains('atk-empty-guide'))return;
 const all=stockItems();if(!all.length)return;
 const q=query().trim(),conds=conditions(),filters=conds.filter(c=>c.kind!=='search'),parts=[];
 // A screen's own empty state with actions (e.g. baby food: 商品を追加する) is kept as it is.
 const custom=!!existing.querySelector('button,a');if(custom&&!q)return;
 const hit=root.AtokoreSearch?.matches||((n,x)=>String(n).includes(x));
 parts.push('<p class="atk-empty-title">'+(q?'「'+esc(q)+'」に一致する商品はありません':'条件に一致する商品はありません')+'</p>');
 if(filters.length){
  const without=q?all.filter(x=>hit(String(x.name),q)).length:all.length;
  parts.push('<p class="atk-empty-why">'+esc(filters.map(c=>c.label).join('・'))+'で絞り込んでいます。</p>');
  parts.push('<button type="button" class="atk-empty-action" data-atk-clear="filters">絞り込みを解除して探す'+(without?'（'+without+'件）':'')+'</button>');
 }
 if(q){
  const maybe=root.AtokoreSearch?.suggestions(q,all.map(x=>x.name),3)||[];
  if(maybe.length)parts.push('<div class="atk-maybe"><span>もしかして：</span>'+maybe.map(w=>'<button type="button" data-atk-maybe="'+esc(w)+'">'+esc(w)+'</button>').join('')+'</div>');
  parts.push('<button type="button" class="atk-empty-action atk-empty-add" data-atk-add-query="'+esc(q)+'">「'+esc(q)+'」をストックに追加する</button>');
 }
 const guide='<div class="empty atk-empty-guide" role="status">'+parts.join('')+'</div>';
 if(custom)existing.insertAdjacentHTML('afterend',guide);else list.innerHTML=guide;
}
const prior=root.renderStock;
if(typeof prior==='function')root.renderStock=function(...args){const r=prior.apply(this,args);try{renderBar();renderEmpty()}catch(e){root.console?.error?.('あとこれ: 検索条件の表示',e)}return r};
doc.addEventListener('click',e=>{
 const c=e.target.closest?.('[data-atk-clear]');
 if(c){const kind=c.dataset.atkClear;if(kind==='filters'){root.AtokoreBabyFlow?.clearStockFilters?.('all');return}clear(kind);return}
 const m=e.target.closest?.('[data-atk-maybe]');
 if(m){const input=$('stockSearch');if(input){input.value=m.dataset.atkMaybe;root.renderStock?.()}return}
 const a=e.target.closest?.('[data-atk-add-query]');
 if(a){const text=a.dataset.atkAddQuery;root.atkOpenAdd?.('stock');root.AtokoreQuickAdd?.prefillFree?.(text)}
});
root.renderStock?.();
})(typeof globalThis!=='undefined'?globalThis:this);
