/* v21: choose an existing stock item directly for an "いつものリスト".
 * A single tap immediately saves ONLY the routine entry, never changes inventory.
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
if(!doc)return;
const $=id=>doc.getElementById(id);
const toId=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pickerId=null;
function routine(id){try{return routines.find(x=>Number(x.id)===id)||null}catch(e){return null}}
function stockById(id){try{return items.find(x=>Number(x.id)===id)||null}catch(e){return null}}
function hasRoutineItem(id,product){
 const r=routine(id);return !!r?.items?.some(x=>x.name===product.name&&x.unit===product.unit);
}
function saveSelected(id,lines){
 const item=routine(id);
 if(!item||!Array.isArray(lines)||!lines.length)return false;
 try{
  root.AtokoreDataSafety?.assertWritable?.();
  const nextItems=(item.items||[]).map(x=>({...x}));
  const seen=new Set(nextItems.map(x=>Number(x.id)));
  let sequence=Math.max(Date.now(),1,...seen);
  const selectedIds=[];
  for(const line of lines){
   const name=String(line.name||'').trim(),unit=String(line.unit||'個'),qty=Number(line.qty);
   if(!name||name.length>120||!unit||!Number.isSafeInteger(qty)||qty<1||qty>999)throw Error('商品を確認してください');
   const existing=nextItems.find(x=>x.name===name&&x.unit===unit);
   if(existing){selectedIds.push(existing.id);continue} // one-tap picker never silently doubles a product
   do{sequence++}while(seen.has(sequence));
   seen.add(sequence);
   const added={id:sequence,name,qty,unit};nextItems.push(added);selectedIds.push(added.id);
  }
  const nextRoutines=routines.map(x=>Number(x.id)===id?{...x,items:nextItems}:x);
  const key='atokoreTrialV4',raw=JSON.stringify({items,buys,routines:nextRoutines});
  root.localStorage.setItem(key,raw);
  if(root.localStorage.getItem(key)!==raw)throw Error('保存内容を検証できませんでした');
  routines=nextRoutines;
  if(typeof routineSession==='object'&&Number(routineSession.routineId)===id){
   for(const value of selectedIds)routineSession.selected.add(value);
  }
  return true;
 }catch(err){
  root.console?.error?.('いつものリストの保存に失敗しました',err);
  notice('保存できませんでした。もう一度お試しください',true);
  return false;
 }
}
function notice(message,error=false){
 let label=$('atkRoutineStockNotice');
 if(!label){label=doc.createElement('div');label.id='atkRoutineStockNotice';label.setAttribute('role','status');label.setAttribute('aria-live','polite');$('pg-stock')?.prepend(label)}
 if(label){label.textContent=message;label.classList.toggle('atk-routine-error',error)}
}
function panel(){
 let el=$('atkRoutineStockPicker');
 if(el)return el;
 el=doc.createElement('section');el.id='atkRoutineStockPicker';el.className='atk-routine-stock-picker';
 el.setAttribute('aria-label','いつものリストに商品を追加');
 const heading=doc.createElement('strong');heading.id='atkRoutineStockHeading';
 const hint=doc.createElement('p');hint.textContent='商品を1回タップすると、このリストにすぐ追加されます。在庫数は変わりません。';
 const done=doc.createElement('button');done.type='button';done.id='atkRoutineStockDone';done.textContent='✓ 完了してリストに戻る';
 done.addEventListener('click',()=>finish());
 el.append(heading,hint,done);
 const title=$('pg-stock')?.querySelector('.atk-page-title');
 if(title)title.insertAdjacentElement('afterend',el);
 else $('pg-stock')?.prepend(el);
 return el;
}
function decorateStockRows(){
 if(!pickerId)return;
 const list=$('stockList');if(!list)return;
 list.querySelectorAll('[data-stock-id]').forEach(row=>{
  const id=toId(row.dataset.stockId);
  const product=id&&stockById(id);if(!product)return;
  const already=hasRoutineItem(pickerId,product);
  row.classList.toggle('atk-routine-stock-added',already);
  row.setAttribute('role','button');row.setAttribute('tabindex','0');
  row.setAttribute('aria-label',product.name+(already?'：リストに追加済み':'：いつものリストに追加'));
  let mark=row.querySelector('.atk-routine-stock-mark');
  if(!mark){mark=doc.createElement('span');mark.className='atk-routine-stock-mark';row.appendChild(mark)}
  mark.textContent=already?'✓ 追加済み':'＋ 追加';
 });
}
function refresh(){
 const p=$('pg-stock');if(!p)return;
 doc.body.classList.toggle('atk-routine-stock-mode',pickerId!==null);
 const el=panel();el.hidden=pickerId===null;
 if(pickerId===null){const label=$('atkRoutineStockNotice');if(label)label.remove();const hint=p.querySelector('.atk-stock-hint');if(hint)hint.textContent='商品をタップして詳細を確認。－／＋で在庫を増減できます。';return}
 const r=routine(pickerId);
 if(!r){finish();return}
 $('atkRoutineStockHeading').textContent='「'+r.name+'」に追加する商品を選ぶ';
 const hint=p.querySelector('.atk-stock-hint');if(hint)hint.textContent='商品をタップして「いつものリスト」に追加できます。';
 decorateStockRows();
}
function finish(){
 const id=pickerId;if(id===null)return;
 pickerId=null;refresh();
 root.go?.('buy');
 root.openRoutine?.(id,true);
}
function addStockItem(id){
 if(pickerId===null)return false;
 const product=stockById(toId(id));if(!product)return false;
 if(hasRoutineItem(pickerId,product)){
  notice('「'+product.name+'」は追加済みです。数量はリスト編集画面で変更できます。');
  return true;
 }
 // A repeat-shopping entry defaults to 1 purchase unit, not the current stock quantity.
 const succeeded=saveSelected(pickerId,[{name:product.name,qty:1,unit:product.unit||'個'}]);
 if(succeeded){
  decorateStockRows();
  notice('「'+product.name+'」をいつものリストに追加しました');
 }
 return succeeded;
}
function start(id){
 id=toId(id);if(!id||!routine(id))return false;
 const current=routine(id),name=$('routineNameEdit');
 if(name&&name.value.trim()!==current.name&&
    !root.confirm?.('リスト名はまだ保存されていません。このまま商品を選びますか？'))return false;
 // Avoid carrying an unfinished quick-add batch into an unrelated mode.
 if(root.AtokoreQuickAdd?.isRoutinePicker?.()&&!root.AtokoreQuickAdd.cancelRoutinePicker(false))return false;
 pickerId=id;
 root.closeM?.();root.go?.('stock');refresh();
 return true;
}
function decorateRoutineModal(id){
 const r=routine(toId(id)),inline=$('sheet')?.querySelector('.routineInline');
 if(!r||!inline||$('atkRoutineCatalogOpen'))return;
 const wrapper=doc.createElement('div');wrapper.className='atk-routine-catalog-entry';
 const button=doc.createElement('button');button.type='button';button.id='atkRoutineCatalogOpen';
 button.className='atk-routine-catalog-button';button.textContent='＋ ストックから商品を追加';
 button.addEventListener('click',()=>start(r.id));
 const help=doc.createElement('p');help.textContent='ストック一覧の商品をタップするだけ。登録中の在庫数は変わりません。';
 wrapper.append(button,help);inline.after(wrapper);
}
const oldOpen=root.openRoutine;
if(typeof oldOpen==='function')root.openRoutine=function(id,...args){
 const result=oldOpen.call(this,id,...args);decorateRoutineModal(id);return result;
};
const oldStock=root.renderStock;
if(typeof oldStock==='function')root.renderStock=function(...args){
 const result=oldStock.apply(this,args);if(pickerId!==null)decorateStockRows();return result;
};
const oldGo=root.go;
if(typeof oldGo==='function')root.go=function(page,...args){
 if(pickerId!==null&&page!=='stock'){pickerId=null;doc.body.classList.remove('atk-routine-stock-mode');refresh()}
 const result=oldGo.call(this,page,...args);
 if(page==='stock')refresh();
 return result;
};
// Capture events before the stock-detail, bulk and inventory +/- event handlers.
// In picker mode every click within a stock row is exclusively a repeat-list action.
doc.addEventListener('click',ev=>{
 if(pickerId===null)return;
 const row=ev.target.closest?.('#stockList [data-stock-id]');
 if(!row)return;
 ev.preventDefault();ev.stopImmediatePropagation();addStockItem(row.dataset.stockId);
},true);
doc.addEventListener('keydown',ev=>{
 if(pickerId===null||!['Enter',' '].includes(ev.key))return;
 const row=ev.target.closest?.('#stockList [data-stock-id]');
 if(!row)return;
 ev.preventDefault();ev.stopImmediatePropagation();addStockItem(row.dataset.stockId);
},true);
root.AtokoreRoutineCatalog=Object.freeze({start,saveSelected,addStockItem,finish,isActive(){return pickerId!==null}});
})(typeof globalThis!=='undefined'?globalThis:this);
