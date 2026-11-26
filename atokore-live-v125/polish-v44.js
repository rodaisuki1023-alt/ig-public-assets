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
// v51: a purchase of a product with a detailed estimate also stored that purchase in its own field
// (tp…, see stock-levels-v51.js). Undo clears exactly that field when it still holds that purchase;
// a purchase already counted into a later correction cannot be taken apart, so it asks to check.
const ENTRY=/^tp[0-9a-z]{1,13}$/;
function addedEntries(a,b){
 if(!a||!b)return [];
 return Object.keys(b).filter(f=>ENTRY.test(f)&&b[f]&&typeof b[f]==='object'&&b[f].k&&(!a[f]||a[f].k!==b[f].k)).map(f=>({field:f,k:b[f].k}));
}
function undoEntries(row,c){
 if(!row||!c.entries)return;
 for(const {field,k} of c.entries){
  if(!row[field]||row[field].k!==k)continue;
  delete row[field];
  const t=row.track;
  if(t&&typeof t==='object'&&Array.isArray(t.seen)&&t.seen.includes(k))row.track={...t,check:'purchase_undo'};
 }
}
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
  undoEntries(row,c);
 }
 return next;
}
// Presentation-only age parsing: ambiguous labels are never guessed.
function foodMonth(name){
 const n=String(name??'').normalize('NFKC');
 const pattern=/(\d+)\s*[歳才](?:\s*(\d+)\s*[かカケヶヵ箇]月|\s*(半))?|(\d+)(?:\s*[〜~、-]\s*(\d+))?\s*[かカケヶヵ箇]月/g;
 const hits=[...n.matchAll(pattern)]; if(hits.length!==1)return null;
 const m=hits[0],value=m[1]?Number(m[1])*12+(m[2]?Number(m[2]):m[3]?6:0):Number(m[4]);
 return Number.isInteger(value)&&value>0&&value<=48?value:null;
}
function foodMonthLabel(month){if(month==null)return '月齢未設定';if(month<12)return month+'か月頃から';const y=Math.floor(month/12),m=month%12;return y+'歳'+(m?m+'か月':'')+'頃から'}
function foodMonthFor(item){
 const explicit=Number(item?.babyFoodMonth);
 if(Number.isInteger(explicit)&&explicit>=1&&explicit<=48)return explicit;
 const d=root.AtokoreBabyFood?.describe?.(item);
 return d?.id&&Number.isInteger(d.month)?d.month:foodMonth(item?.name);
}
const api={stockLabel,inverseCounters,foodMonth,foodMonthLabel,foodMonthFor};
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
function log(title,detail,extra){root.AtokoreHistory?.add(title,detail,'stock','↶',extra)}
// v51 (Work: shared undo race): every bar belongs to one action. A late answer for an older action
// clears only its own bar (clearUndo(run)), never the bar of a purchase made meanwhile.
function clearUndo(run){if(run&&undo!==run)return;undo=null;clearTimeout(undoTimer);doc.getElementById('atkUndoBar')?.remove()}
// v51 (Muse N-3): the last purchase can still be undone after leaving the screen, from a button on
// the shopping page, for at most LAST_PURCHASE_MS and only once. The same undo runs as from the
// bar: it refuses when the products changed, checks the shared ticket on the server while sharing,
// and also takes the purchase out of the estimate. Kept in memory only (a reload ends it).
// v51 (Work P1): the deadline is decided when the undo starts, by both the bar and the button, not
// only when the button is drawn, so a screen left open (or frozen in the background) cannot undo
// after 10:00. Undo is allowed while elapsed < 10:00; 10:00 itself is refused. An undo that started
// before the deadline is finished, never stopped half-way: stopping after the server answered would
// leave the stock and the estimate out of step. Elapsed time is the larger of the wall clock and the
// monotonic clock, so setting the phone's clock back cannot extend the window (setting it forward
// only ends it early). While sharing, the server applies the same window to its own receive time
// (proposal atokore-purchase-undo-window-v51.sql), which is the strict guarantee across phones.
const LAST_PURCHASE_MS=10*60*1000;
const EXPIRED_TEXT='「買った」から10分を過ぎたため、取り消せません。ストックの数量を直接直してください。';
const mono=()=>root.performance&&typeof root.performance.now==='function'?root.performance.now():NaN;
function stamp(){return {wall:Date.now(),mono:mono()}}
function elapsed(at){const w=Date.now()-at.wall,m=mono()-at.mono;return Number.isFinite(m)?Math.max(w,m):w}
function withinUndo(at){const e=elapsed(at);return e>=0&&e<LAST_PURCHASE_MS}
let lastPurchase=null,lastTimer=null;
function renderLastPurchase(){
 clearTimeout(lastTimer);lastTimer=null;
 const anchor=doc.getElementById('buyList');let b=doc.getElementById('atkLastPurchaseUndo');
 // An undo already running is drawn as busy until it finishes, even across the deadline. Busy and
 // errors belong to that purchase only (a newer purchase starts clean).
 const lastBusy=!!lastPurchase?.busy;
 const live=lastPurchase&&(lastBusy||withinUndo(lastPurchase.at));
 if(!live){if(lastPurchase&&undo===lastPurchase.run)clearUndo();lastPurchase=null}
 if(!anchor||!live){b?.remove();return}
 if(!b){b=doc.createElement('div');b.id='atkLastPurchaseUndo';b.className='atk-last-purchase';anchor.before(b)}
 const e=elapsed(lastPurchase.at),min=Math.max(1,Math.round(e/60000));
 b.innerHTML='<span>直前の「買った」：'+esc(lastPurchase.label)+'（約'+min+'分前・あと'+Math.max(1,Math.ceil((LAST_PURCHASE_MS-e)/60000))+'分取り消せます）</span><button type="button" data-atk-last-undo'+(lastBusy?' disabled':'')+'>'+(lastBusy?'取り消し中…':'取り消す')+'</button>'+(lastPurchase.error?'<p role="alert">'+esc(lastPurchase.error)+'</p>':'');
 // Redraw at the deadline (and each minute for the label). Timers stall in the background, so
 // returning to the page also redraws (visibilitychange/pageshow below), and the start re-checks.
 if(!lastBusy)lastTimer=setTimeout(renderLastPurchase,Math.max(50,Math.min(60000,LAST_PURCHASE_MS-e)));
}
doc.addEventListener('click',async e=>{
 const t=e.target.closest?.('[data-atk-last-undo]');const lp=lastPurchase;if(!t||!lp||lp.busy)return;
 if(!withinUndo(lp.at)){renderLastPurchase();message(EXPIRED_TEXT);return}
 lp.busy=true;lp.error=null;renderLastPurchase();
 // Whatever happens, only THIS purchase's state is touched when the answer comes back.
 try{await lp.run();if(lastPurchase===lp)lastPurchase=null;clearUndo(lp.run);message('直前の「買った」を取り消しました')}
 catch(err){lp.error=err.message||'取り消せませんでした。'}
 finally{lp.busy=false;renderLastPurchase()}
});
doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')renderLastPurchase()});
root.addEventListener?.('pageshow',()=>renderLastPurchase());
doc.addEventListener('atokore-page-changed',()=>clearUndo());
doc.addEventListener('atokore-page-changed',()=>renderLastPurchase());
// v51 (Work: recovery after a server undo): estimate repairs that could not be saved yet.
const estimateRepairs=[];
function revertEstimate(changes){const cur=snapshot();for(const c of changes)undoEntries(cur.items.find(x=>String(x.id)===String(c.id)),c);persist(cur)}
function retryEstimateRepairs(){
 while(estimateRepairs.length){
  try{revertEstimate(estimateRepairs[0]);estimateRepairs.shift();if(!estimateRepairs.length)message('見積もりも取り消しました')}
  catch(e){console.error('あとこれ: 見積もりの取り消し（再試行）',e);return}
 }
}
doc.addEventListener('atokore-household-updated',retryEstimateRepairs);
doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')retryEstimateRepairs()});
function offerUndo(label,run){
 clearUndo();root.AtokoreNotices.hide();undo=run;
 const node=doc.createElement('div');node.id='atkUndoBar';node.className='atk-undo-bar';
 const text=doc.createElement('span');text.setAttribute('role','status');text.textContent=label;
 const button=doc.createElement('button');button.type='button';button.textContent='元に戻す';
 button.addEventListener('click',async()=>{
  if(button.disabled||undo!==run)return;button.disabled=true;clearTimeout(undoTimer);
  try{await run();clearUndo(run);message('直前の操作を元に戻しました')}
  catch(e){
   // Only this bar shows the error and gets more time; a newer bar is left as it is.
   if(undo!==run)return;
   text.textContent=e.message||'戻せませんでした。通信状態をご確認ください。';button.disabled=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>clearUndo(run),30000)}
 });
 const close=doc.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','取り消し案内を閉じる');close.addEventListener('click',()=>clearUndo(run));
 node.append(text,button,close);doc.body.append(node);undoTimer=setTimeout(()=>clearUndo(run),20000);
}
function rememberCounter(before,after,key){
 const changes=[];
 for(const a of before[key]){const b=after[key].find(x=>String(x.id)===String(a.id));if(b&&a.qty!==b.qty)changes.push({key,id:a.id,name:a.name,unit:a.unit,delta:Number(b.qty)-Number(a.qty),usage:(Number(b.usage)||0)-(Number(a.usage)||0)})}
 if(!changes.length)return;
 offerUndo(changes.length===1?changes[0].name+'の数量を変更しました':'数量を変更しました',()=>{
  persist(inverseCounters(snapshot(),changes));log('数量変更を取り消し',changes.map(c=>c.name).join('、'),{refs:changes.map(c=>({id:c.id,kind:c.key==='buys'?'buy':'item',name:c.name,unit:c.unit})),change:changes.length===1?'数量を'+(changes[0].delta>0?'−':'＋')+Math.abs(changes[0].delta)+(changes[0].unit||'個')+'戻した':undefined});
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
  const changes=after.items.flatMap(b=>{const a=before.items.find(x=>String(x.id)===String(b.id));const delta=Number(b.qty)-(Number(a?.qty)||0);
   const e=addedEntries(a,b),track=e.length?{entries:e}:{};
   return delta>0?[{key:'items',id:b.id,name:b.name,unit:b.unit,delta,usage:0,...(a?{}:{created:true}),...track}]:[]});
  const hh=root.AtokoreHousehold,shared=hh?.homeState?.().joined,ticket=shared?hh.capturePurchases?.(removed.map(x=>x.id)):null;
  let done=false,running=false;const at=stamp();
  const finish=()=>{done=true;if(lastPurchase?.run===runUndo)lastPurchase=null;renderLastPurchase()};
  const runUndo=async()=>{
   // One undo per purchase, from the bar or the shopping-page button, never twice or at once, and
   // only before the deadline. Checked here, before any change, so every entry point obeys it.
   if(done)throw Error('この購入はすでに取り消しました。');
   if(running)throw Error('取り消しを処理しています。');
   if(!withinUndo(at)){if(lastPurchase?.run===runUndo)lastPurchase=null;renderLastPurchase();throw Error(EXPIRED_TEXT)}
   running=true;try{await undoOnce()}finally{running=false}
  };
  const undoOnce=async()=>{
   if(shared){
    if(!ticket?.length)throw Error('共有先を確認できませんでした。履歴から現在の内容をご確認ください。');
    await hh.undoPurchases(ticket);
    finish();
    // The server reverted the counted stock; the estimate is an ordinary field and is reverted here.
    if(changes.some(c=>c.entries)){
     try{revertEstimate(changes)}
     catch(e){
      // The server already reverted the purchase. The estimate repair is kept and retried on the next
      // sync or return to the app, until it is saved (never silently dropped).
      console.error('あとこれ: 見積もりの取り消し',e);estimateRepairs.push(changes);
      throw Error('「買った」は取り消しましたが、見積もりの保存に失敗しました。次の同期で自動的にやり直します。');
     }
    }
    return;
   }
   if(root.AtokoreHousehold?.homeState?.().joined)throw Error('家族共有の開始後は、この端末だけの購入を戻せません。');
   const next=inverseCounters(snapshot(),changes);
   for(const b of removed){if(next.buys.some(x=>String(x.id)===String(b.id)))throw Error('買い物リストが変わったため戻せません。');next.buys.push(copy(b))}
   persist(next);log('「買った」を取り消し',removed.map(x=>x.name).join('、'),{refs:removed.map(x=>({id:x.id,kind:'buy',name:x.name,unit:x.unit})),change:'買い物リストに戻した'});
   finish();
  };
  offerUndo(removed.length+'商品を「買った」にしました',runUndo);
  lastPurchase={label:removed.map(x=>x.name).slice(0,2).join('、')+(removed.length>2?' ほか'+(removed.length-2)+'商品':''),run:runUndo,at};
  renderLastPurchase();
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
  if(title){const food=root.AtokoreBabyFood?.isRecord(item);const d=food?root.AtokoreBabyFood.describe(item):null;title.textContent=d?.id?[d.maker,d.name,(root.AtokoreStockSort?.mode?.()||'category')==='category'?'':d.age,d.amount,d.format].filter(Boolean).join(' '):item.name;title.title=item.name}
  if(meta){meta.textContent=item.qtyBasis==='unopened'?'未開封の予備'+(item.inUse?'・使用中あり':''):'';meta.hidden=!meta.textContent}
  const expiry=row.querySelector('.expiryBadge'),type=item.expType;
  if(expiry&&type&&type!=='期限なし'&&!expiry.textContent.startsWith(type+'：'))expiry.textContent=type+'：'+expiry.textContent;
  const qty=row.querySelector('.qty b');if(qty)qty.textContent=item.qty+(item.unit||'個');
 }
 // W2 item 8: category headings only for the category order; priority orders run across categories.
 for(const h of list.querySelectorAll('.atk-stock-category'))h.remove();
 if(mode==='list'&&(root.AtokoreStockSort?.mode?.()||'category')==='category'){
  const groups=new Map();
  for(const row of rows){const item=data.find(x=>String(x.id)===row.dataset.stockId);const category=root.AtokoreBabyFood?.isRecord(item)?'離乳食':item?.cat||'その他';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(row)}
  for(const h of list.querySelectorAll('.atk-stock-category'))h.remove();
  for(const cat of [...CATS,...groups.keys()].filter((c,i,a)=>a.indexOf(c)===i)){
   if(!groups.has(cat))continue;
   const heading=doc.createElement('h3');heading.className='atk-stock-category';heading.textContent=cat+'（'+groups.get(cat).length+'商品）';list.append(heading);
   if(cat!=='離乳食'){list.append(...groups.get(cat));continue}
   const ageGroups=new Map();
   for(const row of groups.get(cat)){const item=data.find(x=>String(x.id)===row.dataset.stockId);const month=foodMonthFor(item);if(!ageGroups.has(month))ageGroups.set(month,[]);ageGroups.get(month).push(row)}
   for(const month of [...ageGroups.keys()].sort((a,b)=>a==null?1:b==null?-1:a-b)){const h=doc.createElement('h4');h.className='atk-food-month';h.textContent=foodMonthLabel(month);list.append(h,...ageGroups.get(month))}
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
 root.AtokoreHistory?.add('商品情報を変更',detail,'stock','✎',{refs:[{id:after.id,kind:'item',name:after.name,unit:after.unit}],change:before.qty!==after.qty?before.qty+(before.unit||'個')+' → '+after.qty+(after.unit||'個'):before.name!==after.name?'名前を「'+after.name+'」に変更':'商品情報を変更'});
 if(before.qty!==after.qty)rememberCounter({items:[before]},{items:[after]},'items');
});
doc.addEventListener('atokore-household-updated',()=>{if(undo&&root.AtokoreHousehold?.status?.().state==='removed')clearUndo()});
renderList();
})(typeof globalThis!=='undefined'?globalThis:this);
