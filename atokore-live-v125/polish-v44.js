/* Trial v44: reversible counters, category rows and explicit replenishment. */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA='atokoreTrialV4',PREF='atokoreDisplayPrefsV1';
const CATS=['ベビー','離乳食','食料品','日用品','衛生・薬','子ども','衣類','家電・生活用品','防災','その他'];
const copy=v=>JSON.parse(JSON.stringify(v));
function snapshot(){try{return copy({items,buys,routines})}catch(_){return {items:[],buys:[],routines:[]}}}
function stockLabel(x){return (x.qtyBasis==='unopened'?'未開封 ':'残り ')+x.qty+(x.unit||'個')+(x.qtyBasis==='unopened'&&x.inUse?'・使用中あり':'')}
function inverseCounters(current,changes){
 const next=copy(current);
 for(const c of changes){
  const row=next[c.key].find(x=>String(x.id)===String(c.id));
  if(!row||row.name!==c.name||row.unit!==c.unit||Number(row.qty)-c.delta<0||Number(row.qty)-c.delta>99999)throw Error('商品が変更されたため、その操作を戻せません。現在の内容をご確認ください。');
  // A row the undone action created is removed whole (never left behind at 0), but only while it
  // is exactly as that action left it; otherwise nothing is changed.
  if(c.created){
   if(Number(row.qty)!==c.delta)throw Error('商品が変更されたため、その操作を戻せません。現在の内容をご確認ください。');
   next[c.key]=next[c.key].filter(x=>x!==row);continue;
  }
  row.qty=Number(row.qty)-c.delta;
  if(c.usage)row.usage=Math.max(0,(Number(row.usage)||0)-c.usage);
 }
 return next;
}
const api={stockLabel,inverseCounters};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokorePolish=api;
if(!doc)return;
let undo=null,undoTimer=null,mode='cards';
try{mode=JSON.parse(root.localStorage.getItem(PREF)||'{}').stockView==='list'?'list':'cards'}catch(_){}
function message(t){root.notifyAtokoreV125H?.(t)}
function persist(next){
 root.AtokoreDataSafety?.assertWritable?.();
 const raw=JSON.stringify(next);root.localStorage.setItem(DATA,raw);
 if(root.localStorage.getItem(DATA)!==raw)throw Error('保存結果を確認できませんでした');
 items=next.items;buys=next.buys;routines=next.routines;
 root.render?.();
}
function log(title,detail){root.AtokoreHistory?.add(title,detail,'stock','↶')}
function clearUndo(){undo=null;clearTimeout(undoTimer);doc.getElementById('atkUndoBar')?.remove()}
doc.addEventListener('atokore-page-changed',clearUndo);
function offerUndo(label,run){
 clearUndo();root.AtokoreNotices.hide();undo=run;
 const node=doc.createElement('div');node.id='atkUndoBar';node.className='atk-undo-bar';
 const text=doc.createElement('span');text.setAttribute('role','status');text.textContent=label;
 const button=doc.createElement('button');button.type='button';button.textContent='元に戻す';
 button.addEventListener('click',async()=>{
  if(button.disabled||!undo)return;button.disabled=true;clearTimeout(undoTimer);
  try{await undo();clearUndo();message('直前の操作を元に戻しました')}
  catch(e){text.textContent=e.message||'戻せませんでした。通信状態をご確認ください。';button.disabled=false;undoTimer=setTimeout(clearUndo,30000)}
 });
 const close=doc.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','取り消し案内を閉じる');close.addEventListener('click',clearUndo);
 node.append(text,button,close);doc.body.append(node);undoTimer=setTimeout(clearUndo,20000);
}
function rememberCounter(before,after,key){
 const changes=[];
 for(const a of before[key]){const b=after[key].find(x=>String(x.id)===String(a.id));if(b&&a.qty!==b.qty)changes.push({key,id:a.id,name:a.name,unit:a.unit,delta:Number(b.qty)-Number(a.qty),usage:(Number(b.usage)||0)-(Number(a.usage)||0)})}
 if(!changes.length)return;
 offerUndo(changes.length===1?changes[0].name+'の数量を変更しました':'数量を変更しました',()=>{
  persist(inverseCounters(snapshot(),changes));log('数量変更を取り消し',changes.map(c=>c.name).join('、'));
 });
}
for(const [name,key] of [['adj','items'],['badj','buys']]){
 const original=root[name];if(typeof original!=='function')continue;
 root[name]=function(...args){const before=snapshot(),result=original.apply(this,args),after=snapshot();rememberCounter(before,after,key);return result};
}
for(const name of ['buyOneToStockV125H','bought']){
 const original=root[name];if(typeof original!=='function')continue;
 root[name]=function(...args){
  const before=snapshot(),result=original.apply(this,args),after=snapshot();
  const removed=before.buys.filter(x=>!after.buys.some(y=>String(y.id)===String(x.id)));
  if(!removed.length)return result;
  // Rows that did not exist before were created by this purchase; undo removes them entirely.
  const changes=after.items.flatMap(b=>{const a=before.items.find(x=>String(x.id)===String(b.id));const delta=Number(b.qty)-(Number(a?.qty)||0);return delta>0?[{key:'items',id:b.id,name:b.name,unit:b.unit,delta,usage:0,...(a?{}:{created:true})}]:[]});
  const hh=root.AtokoreHousehold,shared=hh?.homeState?.().joined,ticket=shared?hh.capturePurchases?.(removed.map(x=>x.id)):null;
  offerUndo(removed.length+'商品を「買った」にしました',async()=>{
   if(shared){if(!ticket?.length)throw Error('共有先を確認できませんでした。履歴から現在の内容をご確認ください。');await hh.undoPurchases(ticket);return}
   if(root.AtokoreHousehold?.homeState?.().joined)throw Error('家族共有の開始後は、この端末だけの購入を戻せません。');
   const next=inverseCounters(snapshot(),changes);
   for(const b of removed){if(next.buys.some(x=>String(x.id)===String(b.id)))throw Error('買い物リストが変わったため戻せません。');next.buys.push(copy(b))}
   persist(next);log('「買った」を取り消し',removed.map(x=>x.name).join('、'));
  });
  return result;
 };
}
function inShopping(item){return snapshot().buys.some(x=>root.__atokoreCoreV125H.sameProduct(x,item))}
function replenish(id){
 const item=snapshot().items.find(x=>String(x.id)===String(id));if(!item||inShopping(item))return;
 // Unlike the stock list's quantity-add action, this button is idempotent per existing product.
 root.addStockOneToBuyV125H?.(item.id);root.renderHome?.();
 doc.querySelectorAll('[data-atk-replenish]').forEach(b=>{if(b.dataset.atkReplenish===String(id)){b.disabled=true;b.textContent='買い物に追加済み'}});
}
function renderList(){
 const page=doc.getElementById('pg-stock'),list=doc.getElementById('stockList');if(!page||!list)return;
 let toggle=doc.getElementById('atkStockView');
 if(!toggle){toggle=doc.createElement('div');toggle.id='atkStockView';toggle.className='atk-stock-view';toggle.setAttribute('role','group');toggle.setAttribute('aria-label','ストックの表示方法');toggle.innerHTML='<button type="button" data-atk-view="cards">写真付き3列</button><button type="button" data-atk-view="list">写真なし・詳細一覧</button>';doc.getElementById('stockSearch')?.insertAdjacentElement('beforebegin',toggle)}
 toggle.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.atkView===mode)));
 page.classList.toggle('atk-stock-list-mode',mode==='list');
 const data=snapshot().items;
 const rows=[...list.querySelectorAll('[data-stock-id]')];
 for(const row of rows){
  const item=data.find(x=>String(x.id)===row.dataset.stockId);if(!item)continue;
  const count=row.querySelector('.bf-stock-count');if(count)count.textContent=stockLabel(item);
  if(mode!=='list')continue;
  const title=row.querySelector('.name'),meta=row.querySelector('.meta');
  if(title)title.textContent=item.name;
  if(meta)meta.textContent=[item.place||'保管場所未設定',item.exp?(item.expType||'期限')+' '+item.exp:'',item.qtyBasis==='unopened'?'未開封の予備'+(item.inUse?'・使用中あり':''):'使用中を含む個数'].filter(Boolean).join(' ／ ');
  const qty=row.querySelector('.qty b');if(qty)qty.textContent=item.qty+(item.unit||'個');
 }
 if(mode==='list'){
  const groups=new Map();
  for(const row of rows){const item=data.find(x=>String(x.id)===row.dataset.stockId);const category=root.AtokoreBabyFood?.isRecord(item)?'離乳食':item?.cat||'その他';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(row)}
  for(const h of list.querySelectorAll('.atk-stock-category'))h.remove();
  for(const cat of [...CATS,...groups.keys()].filter((c,i,a)=>a.indexOf(c)===i)){
   if(!groups.has(cat))continue;
   const heading=doc.createElement('h3');heading.className='atk-stock-category';heading.textContent=cat+'（'+groups.get(cat).length+'商品）';list.append(heading,...groups.get(cat));
  }
 }
}
for(const name of ['renderStock']){
 const original=root[name];if(typeof original==='function')root[name]=function(...args){const result=original.apply(this,args);renderList();return result};
}
doc.addEventListener('click',e=>{
 const view=e.target.closest?.('[data-atk-view]');
 if(view){const selected=view.dataset.atkView;if(!['cards','list'].includes(selected)||selected===mode)return;mode=selected;
  try{const p=JSON.parse(root.localStorage.getItem(PREF)||'{}');root.localStorage.setItem(PREF,JSON.stringify({...p,stockView:mode}))}catch(_){message('表示は切り替えましたが、次回のために保存できませんでした')}
  root.renderStock?.();return;
 }
 const add=e.target.closest?.('[data-atk-replenish]');if(add){e.preventDefault();e.stopPropagation();replenish(add.dataset.atkReplenish)}
});
// All successful quantity edits, including the detail editor, become concrete local activity.
doc.addEventListener('atokore-stock-edited',e=>{
 const {before,after}=e.detail||{};if(!before||!after)return;
 const detail=before.qty!==after.qty?before.name+' '+before.qty+(before.unit||'個')+' → '+after.qty+(after.unit||'個'):after.name+'の商品情報を変更';
 root.AtokoreHistory?.add('商品情報を変更',detail,'stock','✎');
 if(before.qty!==after.qty)rememberCounter({items:[before]},{items:[after]},'items');
});
doc.addEventListener('atokore-household-updated',()=>{if(undo&&root.AtokoreHousehold?.status?.().state==='removed')clearUndo()});
renderList();
})(typeof globalThis!=='undefined'?globalThis:this);
