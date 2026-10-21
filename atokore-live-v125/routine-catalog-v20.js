/* v20: Select products from the familiar catalog for an existing repeat-shopping routine.
 * This route adds ONLY routine entries, never stock or shopping records.
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
if(!doc)return;
const $=id=>doc.getElementById(id);
const toId=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null};
function routine(id){try{return routines.find(x=>Number(x.id)===id)||null}catch(e){return null}}
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
   const name=String(line.name||'').trim(),unit=String(line.unit||'個');
   const qty=Number(line.qty);
   if(!name||name.length>120||!unit||!Number.isSafeInteger(qty)||qty<1||qty>999)throw Error('商品を確認してください');
   const exists=nextItems.find(x=>x.name===name&&x.unit===unit);
   if(exists){exists.qty=Math.min(999,Number(exists.qty||0)+qty);selectedIds.push(exists.id)}
   else{
    do{sequence++}while(seen.has(sequence));
    seen.add(sequence);
    const added={id:sequence,name,qty,unit};
    nextItems.push(added);selectedIds.push(added.id);
   }
  }
  const nextRoutines=routines.map(x=>Number(x.id)===id?{...x,items:nextItems}:x);
  const key='atokoreTrialV4',raw=JSON.stringify({items,buys,routines:nextRoutines});
  root.localStorage.setItem(key,raw);
  if(root.localStorage.getItem(key)!==raw)throw Error('書き込みを確認できませんでした');
  routines=nextRoutines;
  if(typeof routineSession==='object'&&Number(routineSession.routineId)===id)
   for(const value of selectedIds)routineSession.selected.add(value);
  return true;
 }catch(err){
  root.console?.error?.('いつものリストに商品を追加できませんでした',err);
  root.alert?.('保存できませんでした。在庫と買い物リストは変更していません。');
  return false;
 }
}
function start(id){
 id=toId(id);if(!id||!routine(id))return false;
 const item=routine(id);
 const edited=$('routineNameEdit');
 if(edited&&edited.value.trim()!==item.name&&
    !root.confirm?.('リスト名はまだ保存されていません。このまま商品選択へ進みますか？'))return false;
 if(!root.AtokoreQuickAdd?.openRoutinePicker?.(id,rows=>saveSelected(id,rows)))return false;
 root.closeM?.();
 return true;
}
function decorate(id){
 const item=routine(toId(id));if(!item)return;
 const inline=$('sheet')?.querySelector('.routineInline');
 if(!inline||$('atkRoutineCatalogOpen'))return;
 const wrapper=doc.createElement('div');wrapper.className='atk-routine-catalog-entry';
 const button=doc.createElement('button');button.type='button';button.id='atkRoutineCatalogOpen';
 button.className='atk-routine-catalog-button';button.textContent='＋ 商品一覧から追加';
 button.addEventListener('click',()=>start(item.id));
 const help=doc.createElement('p');help.textContent='おむつ・ミルク・食品などから選べます。ストック数は増えません。';
 wrapper.append(button,help);
 inline.after(wrapper);
}
const oldOpen=root.openRoutine;
if(typeof oldOpen==='function')root.openRoutine=function(id,...args){
 const result=oldOpen.call(this,id,...args);decorate(id);return result;
};
// If users navigate away using bottom tabs, a routine draft cannot accidentally
// be committed into ordinary stock on a later visit.
const oldGo=root.go;
if(typeof oldGo==='function')root.go=function(page,...args){
 if(page!=='add'&&root.AtokoreQuickAdd?.isRoutinePicker?.()){
  if(!root.AtokoreQuickAdd.cancelRoutinePicker(false))return;
 }
 return oldGo.call(this,page,...args);
};
root.AtokoreRoutineCatalog=Object.freeze({start,saveSelected});
})(typeof globalThis!=='undefined'?globalThis:this);
