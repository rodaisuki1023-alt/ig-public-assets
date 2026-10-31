/* Atokore W2 item 8 on screen:
 * - Stock sort order, always shown as 「並び順：…」 and remembered on this device.
 *   Default 「カテゴリー別」 (category -> name); priority orders run across categories.
 *   The shopping list keeps the order things were added.
 * - Each stock and shopping row shows its category once, as its own label (never in the brand badge).
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const Rules=root.AtokoreStockRules;
if(!doc||!Rules)return;
const $=id=>doc.getElementById(id);
const PREF='atokoreDisplayPrefsV1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function readPref(){try{return JSON.parse(root.localStorage.getItem(PREF)||'{}')||{}}catch(_){return {}}}
let mode=Rules.SORT_KEYS.includes(readPref().stockSort)?readPref().stockSort:'category';
function stockItems(){try{return Array.isArray(items)?items:[]}catch(_){return []}}
function buyItems(){try{return Array.isArray(buys)?buys:[]}catch(_){return []}}
const isBabyFood=x=>!!root.AtokoreBabyFood?.isRecord?.(x);
const categoryOf=x=>Rules.categoryOf(x,isBabyFood);

function setMode(next){
 if(!Rules.SORT_KEYS.includes(next)||next===mode)return;
 mode=next;
 try{root.localStorage.setItem(PREF,JSON.stringify({...readPref(),stockSort:mode}))}catch(_){root.notifyAtokoreV125H?.('並び順は変えましたが、次回のために保存できませんでした')}
 root.renderStock?.();
}
function renderControl(){
 const chips=$('catChips'),list=$('stockList');if(!list)return;
 let box=$('atkStockSort');
 if(!box){
  box=doc.createElement('div');box.id='atkStockSort';box.className='atk-sort';
  box.innerHTML='<span class="atk-sort-current" aria-hidden="true"></span><select aria-label="並び順">'+Rules.SORTS.map(([k,l])=>'<option value="'+k+'">'+esc(l)+'</option>').join('')+'</select>';
  box.querySelector('select').addEventListener('change',e=>setMode(e.target.value));
  (chips||list).insertAdjacentElement(chips?'afterend':'beforebegin',box);
 }
 box.querySelector('.atk-sort-current').textContent='並び順：'+Rules.sortLabel(mode);
 const select=box.querySelector('select');if(select.value!==mode)select.value=mode;
}
// Category label: one per row, separate from the brand badge.
function labelRow(row,item){
 if(!item)return;
 const cat=categoryOf(item);
 row.querySelectorAll('.stableCat,.catMark').forEach(n=>n.remove());
 const badge=row.querySelector('.atk-row-brand.atk-row-generic');
 if(badge&&!badge.children.length&&badge.textContent.trim()===String(item.cat||'商品').slice(0,4)){badge.textContent='';badge.setAttribute('aria-hidden','true')}
 row.querySelectorAll('.grow > .meta').forEach(m=>{if(m.textContent.trim()===cat||m.textContent.trim()===String(item.cat||'')){m.textContent='';m.hidden=true}});
 let label=row.querySelector('.atk-row-cat');
 if(!label){
  label=doc.createElement('span');label.className='atk-row-cat';
  const anchor=row.querySelector('.grow > .stableBuyHead')||row.querySelector('.grow > .name');
  if(anchor)anchor.insertAdjacentElement('afterend',label);else return;
 }
 label.textContent=cat;label.setAttribute('aria-label','カテゴリー：'+cat);
}
function labelStock(){const all=stockItems();doc.querySelectorAll('#stockList [data-stock-id]').forEach(r=>labelRow(r,all.find(x=>String(x.id)===r.dataset.stockId)))}
// A shopping item saved without a category shows the one it will get in stock when bought:
// its stock row's category, or the same guess 「買った」 uses.
function buyCategory(item){
 if(item.cat)return item;
 const linked=item.stockId!=null?stockItems().find(x=>String(x.id)===String(item.stockId)):null;
 const cat=linked?.cat||root.atokoreInferCategory?.(String(item.name||''))||'';
 return cat?{...item,cat}:item;
}
function labelBuy(){const all=buyItems();doc.querySelectorAll('#buyList [data-buy-id]').forEach(r=>{const item=all.find(x=>String(x.id)===r.dataset.buyId);labelRow(r,item&&buyCategory(item))})}

const priorVisible=root.visibleStock;
if(typeof priorVisible==='function')root.visibleStock=function(...args){
 const shown=priorVisible.apply(this,args);
 return Rules.sortItems(shown,mode,{registered:stockItems(),isBabyFood,reorderAt:root.atokoreReorderAt});
};
const priorStock=root.renderStock;
if(typeof priorStock==='function')root.renderStock=function(...args){const r=priorStock.apply(this,args);try{renderControl();labelStock()}catch(e){root.console?.error?.('あとこれ: 並び順の表示',e)}return r};
const priorBuy=root.renderBuy;
if(typeof priorBuy==='function')root.renderBuy=function(...args){const r=priorBuy.apply(this,args);try{labelBuy()}catch(e){root.console?.error?.('あとこれ: カテゴリーの表示',e)}return r};
root.AtokoreStockSort=Object.freeze({mode:()=>mode,setMode});
root.renderStock?.();root.renderBuy?.();
})(typeof globalThis!=='undefined'?globalThis:this);
