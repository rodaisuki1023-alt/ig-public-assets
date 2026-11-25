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
 return Array.isArray(list)?list.filter(x=>x&&typeof x.name==='string'&&x.done!==true).slice(0,50):null;
}
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
 const line=(title,names,cls)=>names.length?'<li class="'+cls+'"><b>'+esc(title)+'</b>'+names.map(esc).join('、')+'</li>':'';
 box.innerHTML='<summary><span>出かける前の確認</span><span class="atk-pack-short-count">'+(total?'要確認 '+total+'件':'買い物リストにあり')+'</span></summary>'+
  '<ul>'+line('在庫0：',c.zero,'zero')+line('サイズ・種類を選んでください：',c.choose,'choose')+line('在庫を確認してください：',c.unknown,'unknown')+line('買い物リストにあります：',c.queued,'queued')+'</ul>'+
  (c.zero.length?'<button type="button" class="atk-pack-short-add" data-pack-short-add>在庫0の'+c.zero.length+'件を買い物リストへ</button>':'')+
  '<p class="atk-pack-short-note">チェックしても在庫の数は変わりません。必要な枚数は家庭ごとに違うため、足りるかどうかは決めつけません。</p>'+
  (lastMessage?'<p class="atk-pack-short-msg" role="status">'+esc(lastMessage)+'</p>':'');
 if(open)box.open=true;
}
section.addEventListener('click',event=>{
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
