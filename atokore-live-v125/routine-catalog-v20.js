/* v26: select unregistered products through the add catalog, then save only the list.
 * Stock selection saves ONLY the routine entry, never changes inventory.
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
 const hint=doc.createElement('p');hint.textContent='商品を選ぶと確認画面が出ます。承認後にこのリストだけに追加され、ストック数は変わりません。';
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
 const hint=p.querySelector('.atk-stock-hint');if(hint)hint.textContent='商品をタップして確認後に「いつものリスト」に追加できます。';
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
 const list=routine(pickerId);
 const prompt='「'+product.name+'」を「'+(list?.name||'いつものリスト')+'」に追加してもいいですか？\n\n※ ストック数は変わりません。';
 if(!root.confirm?.(prompt))return false;
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
function startCatalog(id){
 id=toId(id);if(!id||!routine(id))return false;
 const current=routine(id),name=$('routineNameEdit');
 if(name&&name.value.trim()!==current.name&&
    !root.confirm?.('リスト名はまだ保存されていません。このまま商品を選びますか？'))return false;
 if(!root.AtokoreQuickAdd?.openRoutinePicker?.(id,lines=>saveSelected(id,lines)))return false;
 pickerId=null;refresh();root.closeM?.();
 return true;
}
function decorateRoutineModal(id){
 const sheet=$('sheet'),r=routine(toId(id)),inline=sheet?.querySelector('.routineInline');
 if(!r||!inline||$('atkRoutineCatalogOpen'))return;
 sheet.classList.add('atk-routine-sheet');
 const nameSave=sheet.querySelector('[onclick^="saveRoutineName("]');
 if(nameSave){nameSave.classList.add('atk-routine-name-save');nameSave.removeAttribute('style')}
 if(inline.previousElementSibling?.classList.contains('section'))inline.previousElementSibling.textContent='リストの商品';
 const wrapper=doc.createElement('div');wrapper.className='atk-routine-catalog-entry';
 const button=doc.createElement('button');button.type='button';button.id='atkRoutineCatalogOpen';
 button.className='atk-routine-catalog-button';button.textContent='商品を選ぶ';
 button.title='商品追加画面で選び、いつものリストに追加';
 button.addEventListener('click',()=>startCatalog(r.id));
 wrapper.append(button);
 const manual=doc.createElement('details');manual.className='atk-routine-manual';
 const summary=doc.createElement('summary');summary.textContent='商品名を手入力する';manual.append(summary);
 inline.before(wrapper,manual);manual.append(inline);
 sheet.querySelectorAll('.routineCheck').forEach(el=>el.remove());
 sheet.querySelectorAll('.routineActions').forEach(el=>el.remove());
 sheet.querySelector('[onclick^="addSelectedRoutine("]')?.remove();
 const remove=sheet.querySelector('[onclick^="deleteRoutine("]');
 if(remove){
  const manage=doc.createElement('details');manage.className='atk-routine-manage';
  const label=doc.createElement('summary');label.textContent='リストの管理';manage.append(label);
  remove.before(manage);manage.append(remove);
 }
 for(const row of $('routineItems')?.querySelectorAll('.row')||[]){
  const name=row.querySelector('.name'),line=r.items[Array.from($('routineItems').children).indexOf(row)];
  if(!name||!line)continue;
  name.title=line.name;
  const info=root.AtokorePeachUI?.describe(line),kind=root.AtokoreBabyKit?.kind(line.name);
  const picture=doc.createElement('span');picture.className='atk-routine-product-icon';
  picture.innerHTML=kind?root.AtokoreBabyKit.icon(kind,52):(root.AtokoreQuickAdd?.iconFor(line.name)||'');
  row.prepend(picture);
  if(info?.brand){
   name.textContent=info.brand.jp+' '+info.line;
   const meta=doc.createElement('small');meta.className='atk-routine-variant';
   meta.textContent=[info.type,info.size?info.size+'サイズ':''].filter(Boolean).join('・');
   name.after(meta);
  }
  const del=row.querySelector('.danger');
  if(del){del.textContent='削除';del.setAttribute('aria-label',line.name+'をリストから削除')}
 }
 const scroll=doc.createElement('div');scroll.className='atk-routine-scroll';
 scroll.append(...Array.from(sheet.childNodes));sheet.append(scroll);
 const footer=doc.createElement('footer');footer.className='atk-routine-footer';
 const note=doc.createElement('p');note.textContent='追加する前に、商品と数量を確認します。';
 const actions=doc.createElement('div');actions.className='atk-routine-destinations';
 const stock=doc.createElement('button');stock.type='button';stock.className='atk-routine-catalog-button atk-routine-stock-commit';
 stock.id='atkRoutineStockCommit';stock.textContent='ストックに追加';
 stock.addEventListener('click',()=>root.AtokoreBabyFlow?.addRoutineToStock?.(r.id));
 const buy=doc.createElement('button');buy.type='button';buy.className='atk-routine-catalog-button atk-routine-buy-commit';
 buy.id='atkRoutineBuyCommit';buy.textContent='買い物へ追加';
 buy.addEventListener('click',()=>root.AtokoreBabyFlow?.addRoutineToBuy?.(r.id));
 actions.append(stock,buy);footer.append(note,actions);sheet.append(footer);
}
const previousOpenM=root.openM;
if(typeof previousOpenM==='function')root.openM=function(...args){
 $('sheet')?.classList.remove('atk-routine-sheet');return previousOpenM.apply(this,args);
};
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
// Deleting a list asks in the app's own dialog (a native confirm() can be suppressed without UI and
// then the button looks dead). The existing delete (history entry, save checks) runs unchanged once
// the person has confirmed here; it is only told that the question was already answered.
const legacyDelete=root.deleteRoutine;
if(typeof legacyDelete==='function')root.deleteRoutine=function(id){
 const dialog=root.AtokoreConfirm,list=routine(toId(id));
 if(!dialog?.open||!list)return legacyDelete.call(this,id);
 const count=Array.isArray(list.items)?list.items.length:0;
 dialog.open('「'+list.name+'」を削除しますか？','このいつものリスト（'+count+'商品）を削除します。ストックと買い物リストは変わりません。','削除する',()=>{
  const before=routines,nativeConfirm=root.confirm;
  root.confirm=()=>true;
  try{legacyDelete.call(this,list.id)}finally{root.confirm=nativeConfirm}
  let stored=null;try{stored=JSON.parse(root.localStorage.getItem('atokoreTrialV4')||'null')}catch(e){}
  if(!stored||!Array.isArray(stored.routines)||stored.routines.some(x=>x.id===list.id)){
   // Not saved: keep showing the list exactly as it is stored.
   if(!routines.some(x=>x.id===list.id))routines=before;
   root.render?.();return false;
  }
  root.notifyAtokoreV125H?.('「'+list.name+'」を削除しました');
  return true;
 });
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
