/* Atokore v51: one folded line under the packing checklist that collects what to check before
 * going out, from the items not yet ticked. It never changes stock and never guesses amounts:
 *  - stock counted as 0 and not yet on the shopping list -> may be added, in one tap, through the
 *    existing shopping owner (AtokoreKitShoppingV50: same-name dedupe, save verification, history);
 *  - several sizes/kinds registered -> "サイズ・種類を選んでください" (nothing is added);
 *  - a consumable not registered as stock -> "在庫を確認してください" (unknown is not zero);
 *    reusable things (連絡帳, 着替え, 水筒 …) without stock are not stock questions and are not listed;
 *  - already on the shopping list -> shown, never added twice.
 * The checklist itself is read only (its own module owns writes and stale-tab protection).
 */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;
const section=doc&&doc.getElementById('atkPackingMvp');
if(!section)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,lastMessage='';

function pending(){
 const list=root.AtokorePackingChecklist?.items?.();
 if(!Array.isArray(list))return null;
 // v51: today's weekday/event rows of every child (prep-sets-v51.js) join the base checklist.
 // A name needed by several children is listed once with how many need it.
 const counts=new Map();
 for(const x of list)if(x&&typeof x.name==='string'&&x.done!==true)counts.set(x.name,Math.max(counts.get(x.name)||0,1));
 // The base list is shared, not per child: per-child rows decide the count when they exist.
 for(const r of root.AtokorePrepSets?.pending?.()||[])counts.set(r.name,r.children);
 lastCounts=counts;
 return [...counts.keys()].slice(0,80).map(name=>({name}));
}
let lastCounts=new Map();
const withCount=name=>(lastCounts.get(name)||1)>1?name+'（'+lastCounts.get(name)+'人分）':name;
// Things that run out. An unregistered reusable item (連絡帳, 着替え, 水筒 …) is not a stock
// question, so only these are asked about when they are not registered.
const CONSUMABLE=/おむつ|オムツ|パンツ|おしりふき|ミルク|離乳食|ベビーフード|ティッシュ|ウェット|マスク|絆創膏|ばんそうこう|ビニール袋|ゴミ袋|ごみ袋|ポリ袋|母乳パッド|ガーゼ|保湿|ワセリン|麦茶|飲み物/;
// Pure classification (exported for tests): one line per unticked item that needs attention.
function classify(names,choices){
 const out={zero:[],choose:[],unknown:[],queued:[]};
 const seen=new Set();
 for(const name of names){
  const key=String(name).normalize('NFKC').trim();if(!key||seen.has(key))continue;seen.add(key);
  const c=choices(name);if(!c)continue;
  if(c.queued?.length||c.stocks?.some(s=>s.queued)){out.queued.push(name);continue}
  if(!c.stocks?.length){if(CONSUMABLE.test(key))out.unknown.push(name);continue}
  if(c.stocks.length>1){out.choose.push(name);continue}
  if(Number(c.stocks[0].qty)===0)out.zero.push(name);
 }
 return out;
}
// Several sizes/brands for one checklist item: list each registered product with its size and
// what is known about its stock, so the person picks the right one. Only a product counted as 0
// (and not already queued) can be added here; anything else is shown, never guessed.
function candidates(names,bridge){
 if(!names.length)return '';
 const L=root.AtokoreStockLevels,day=root.AtokoreStockLevelsUI?.today?.();
 const all=(()=>{try{return Array.isArray(items)?items:[]}catch(_){return []}})();
 return names.map(name=>{
  const c=bridge.choices(name);if(!c?.stocks?.length)return '';
  const rows=c.stocks.map(st=>{
   const item=all.find(x=>String(x.id)===String(st.id));
   const e=L&&item&&day?L.estimate(item,day):null;
   const est=e?.status==='estimate'?'・見積もり あと'+e.range[0]+'〜'+e.range[1]+'日':e?.status==='unknown'?'・見積もりは要確認':'';
   const state=st.queued?'<span class="atk-pack-cand-state">買い物リストにあります</span>':
    Number(st.qty)===0?'<button type="button" class="atk-pack-cand-add" data-pack-cand-add="'+esc(name)+'" data-pack-cand-id="'+esc(st.id)+'">これを買い物へ</button>':
    '<span class="atk-pack-cand-state">在庫あり</span>';
   return '<li><span class="atk-pack-cand-name">'+esc(st.name)+'</span><span class="atk-pack-cand-qty">在庫 '+esc(st.qty)+esc(st.unit)+esc(est)+'</span>'+state+'</li>';
  }).join('');
  return '<div class="atk-pack-cands"><p class="atk-pack-cands-head">「'+esc(name)+'」の候補（'+c.stocks.length+'件）</p><ul>'+rows+'</ul></div>';
 }).join('');
}
function paint(){
 const bridge=root.AtokoreKitShoppingV50,list=pending();
 let box=doc.getElementById('atkPackShort');
 if(!bridge?.choices||!list){box?.remove();return}
 const c=classify(list.map(x=>x.name),bridge.choices);
 const total=c.zero.length+c.choose.length+c.unknown.length;
 if(!total&&!c.queued.length&&!lastMessage){box?.remove();return}
 const open=box?.open;
 if(!box){box=doc.createElement('details');box.id='atkPackShort';box.className='atk-pack-short';
  (doc.getElementById('atkPackProgress')||section.firstElementChild).after(box)}
 const line=(title,names,cls)=>names.length?'<li class="'+cls+'"><b>'+esc(title)+'</b>'+names.map(n=>esc(withCount(n))).join('、')+'</li>':'';
 box.innerHTML='<summary><span>出かける前の確認</span><span class="atk-pack-short-count">'+(total?'要確認 '+total+'件':'買い物リストにあり')+'</span></summary>'+
  '<ul>'+line('在庫0：',c.zero,'zero')+line('サイズ・種類を選んでください：',c.choose,'choose')+line('在庫を確認してください：',c.unknown,'unknown')+line('買い物リストにあります：',c.queued,'queued')+'</ul>'+
  candidates(c.choose,bridge)+
  (c.zero.length?'<button type="button" class="atk-pack-short-add" data-pack-short-add>在庫0の'+c.zero.length+'件を買い物リストへ</button>':'')+
  '<p class="atk-pack-short-note">チェックしても在庫の数は変わりません。必要な枚数は家庭ごとに違うため、足りるかどうかは決めつけません。</p>'+
  (lastMessage?'<p class="atk-pack-short-msg" role="status">'+esc(lastMessage)+'</p>':'');
 if(open)box.open=true;
}
section.addEventListener('click',event=>{
 const pick=event.target.closest?.('[data-pack-cand-add]');
 if(pick&&!busy){
  const bridge=root.AtokoreKitShoppingV50;if(!bridge?.add)return;
  busy=true;pick.disabled=true;
  try{
   const r=bridge.add(pick.dataset.packCandAdd,pick.dataset.packCandId);
   lastMessage=r?.status==='added'?(r.name||'商品')+'を買い物リストに追加しました。':r?.status==='already'?'すでに買い物リストにあります。':r?.status==='failed'?'買い物リストに保存できませんでした。空き容量を確認してください。':'追加できませんでした。';
  }finally{busy=false;paint();const box=doc.getElementById('atkPackShort');if(box)box.open=true;setTimeout(()=>{lastMessage='';paint()},8000)}
  return;
 }
 const t=event.target.closest?.('[data-pack-short-add]');if(!t||busy)return;
 const bridge=root.AtokoreKitShoppingV50,list=pending();if(!bridge?.add||!list)return;
 busy=true;t.disabled=true;
 try{
  const c=classify(list.map(x=>x.name),bridge.choices);
  let added=0,failed=0;
  for(const name of c.zero){const r=bridge.add(name);if(r?.status==='added')added++;else if(r?.status==='failed')failed++}
  lastMessage=failed?'買い物リストに保存できなかった商品があります（'+failed+'件）。空き容量を確認してください。':added?added+'件を買い物リストに追加しました。':'追加する商品はありませんでした。';
 }finally{busy=false;paint();const box=doc.getElementById('atkPackShort');if(box)box.open=true;setTimeout(()=>{lastMessage='';paint()},8000)}
});
// Repaint when the checklist rows or the shopping list change (both modules re-render their lists).
const watch=new root.MutationObserver(()=>{if(!busy)paint()});
for(const id of ['atkPackRows','buyList','stockList'])if(doc.getElementById(id))watch.observe(doc.getElementById(id),{childList:true});
paint();
root.AtokorePackingShortage=Object.freeze({classify,refresh:paint});
})(typeof window!=='undefined'?window:globalThis);
