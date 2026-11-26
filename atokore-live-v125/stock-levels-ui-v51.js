/* Atokore v51 stock levels on screen. Logic: stock-levels-v51.js (pure, on-device).
 * - The product sheet gets "かんたん管理" (余裕あり / そろそろ / 買う) and, folded, the optional
 *   detailed estimate. Nothing here changes the counted stock (qty) by itself: "使い切った" asks
 *   before setting the count to 0.
 * - Items without a level or estimate behave exactly as before (the existing reorder-line rule).
 * - Levels and estimates are ordinary item fields, so they reach the family with the usual sync.
 */
(function(root){
'use strict';
const L=root.AtokoreStockLevels,doc=typeof document!=='undefined'?document:null;
if(!L||!doc)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
function list(){try{return Array.isArray(items)?items:[]}catch(_){return []}}
function find(id){return list().find(x=>Number(x.id)===Number(id))}

// The shared "needs refill" rule. A level the person set, or a usable estimate, decides first;
// everything else keeps the previous rule (count at or below the reorder line).
const baseLow=root.atokoreIsLow||(x=>Number(x.qty)<=1);
root.atokoreIsLow=function(x){
 const d=L.displayLevel(x,today());
 // A level chosen long ago, or 余裕あり while the count is 0, is brought back to the person.
 if(d.source==='manual')return d.level!=='plenty'||!!manualState(x,today());
 if(d.source==='estimate'&&d.level!=='unknown')return d.level!=='plenty'&&!d.estimate.snoozed;
 return baseLow(x);
};

// Save a change to one product. On failure the product is restored and the person is told.
function update(id,change){
 const item=find(id);if(!item)return false;
 const before=JSON.stringify(item);
 change(item);
 for(const k of Object.keys(item))if(item[k]===undefined)delete item[k];
 if(typeof root.save==='function'&&root.save()===false){
  const old=JSON.parse(before);for(const k of Object.keys(item))delete item[k];Object.assign(item,old);
  notice('端末に保存できませんでした。空き容量を確認してください。');return false;
 }
 try{root.renderStock?.();root.renderHome?.()}catch(e){console.error('あとこれ: 在庫表示',e)}
 return true;
}
// Purchases recorded long before the new observation are history: clear their fields.
function tidy(item){for(const f of L.staleEntries(item))item[f]=undefined}
function notice(text){try{root.notifyAtokoreV125H?root.notifyAtokoreV125H(text):root.alert?.(text)}catch(_){}}
function error(id,text){const e=doc.querySelector('[data-atk-level-id="'+Number(id)+'"] .atk-level-error');if(e){e.textContent=text||'';e.hidden=!text}}

function estimateText(e,unit){
 if(e.status==='none')return '';
 if(e.status==='unknown'){
  return e.reason==='stale'?'前回の確認から'+e.days+'日たちました。残りを確認して「まだある」か「使い切った」を押してください。'
   :e.reason==='size_changed'?'サイズが変わったため、見積もりをやり直してください。'
   :e.reason==='purchase_unit'?'買った分を見積もりに足せませんでした（1袋の数や単位が分からないため）。残りを確認して「まだある」に数を入れてください。'
   :e.reason==='purchase_overlap'?'家族の購入と残りの確認が同じころに重なりました。今の残りを確認して「まだある」に数を入れてください。'
   :e.reason==='purchase_undo'?'「買った」を取り消しましたが、その後に見積もりが変わっていたため自動で戻していません。残りを確認してください。'
   :'見積もりできません。残りを確認してください。';
 }
 const left=e.packs!=null?'約'+e.packs+unit.container+'（'+e.remaining+unit.piece+'）':'約'+e.remaining+unit.piece;
 return '見積もり：残り'+left+'・あと'+e.range[0]+'〜'+e.range[1]+'日（'+e.since.slice(5).replace('-','/')+'時点の数から1日'+amount(e.perDay)+unit.piece+'で計算）。実際の在庫数とは別です。';
}
// The last correction (まだある／使い切った) can be put back while nothing else changed the estimate.
let lastFix=null;
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function fixUndoable(x){return lastFix&&lastFix.id===Number(x.id)&&same(x.track,lastFix.after)}
// A level the person chose is shown with its date; after STALE_DAYS it asks to be checked again.
// 'stale' (chosen long ago) or 'conflict' (余裕あり while the count is 0): shown, never auto-fixed.
function manualState(x,t){
 const at=typeof x?.levelAt==='string'?x.levelAt.slice(0,10):'';
 if(!L.LEVELS.includes(x?.level)||!/^\d{4}-\d{2}-\d{2}$/.test(at))return null;
 if(Math.round((Date.parse(t+'T00:00:00Z')-Date.parse(at+'T00:00:00Z'))/86400000)>L.STALE_DAYS)return 'stale';
 if(x.level==='plenty'&&Number(x.qty)===0)return 'conflict';
 return null;
}
function manualNote(x,t){
 const at=typeof x.levelAt==='string'?x.levelAt.slice(0,10):'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(at))return '';
 const days=Math.round((Date.parse(t+'T00:00:00Z')-Date.parse(at+'T00:00:00Z'))/86400000);
 const when=at.slice(5).replace('-','/')+'に設定';
 if(days>L.STALE_DAYS)return '<p class="atk-level-note atk-level-stale" role="note">'+esc(when)+'。'+days+'日たったので、今の残りを確認して選び直してください。</p>';
 if(x.level==='plenty'&&Number(x.qty)===0)return '<p class="atk-level-note atk-level-stale" role="note">'+esc(when)+'。在庫数は0になっています。どちらが正しいか確認してください。</p>';
 return '<p class="atk-level-note">'+esc(when)+'</p>';
}
// v51 (Muse N-1b): the daily use is entered in one of two explicit ways, and the chosen one is
// always used. Switching only shows the other inputs; nothing typed or saved is discarded.
function rateHTML(kind,id,track,pu){
 const mode=track?.rateMode||'total',kids=track?.perChild||[],name='atkRate'+kind+id;
 const radio=(v,label)=>'<label class="atk-level-mode-opt"><input type="radio" name="'+name+'" value="'+v+'" data-atk-rate-mode'+(mode===v?' checked':'')+'><span>'+label+'</span></label>';
 const day=kind==='edit'?'data-atk-level-edit-day':'data-atk-level-per-day';
 return '<fieldset class="atk-level-rate" data-atk-rate><legend>1日に使う量の入れ方</legend>'+
  '<div class="atk-level-mode">'+radio('total','合計を直接入れる')+radio('children','子どもごとに入れる（自動で合計）')+'</div>'+
  '<label class="atk-level-field" data-atk-rate-total'+(mode==='total'?'':' hidden')+'>1日に使う量（全員の合計）<input type="number" inputmode="decimal" min="0" step="any" '+day+' value="'+esc(track?amount(track.perDay):'')+'"'+(kind==='start'?' placeholder="例：6"':'')+'><span>'+pu+'</span></label>'+
  '<div class="atk-level-kid-grid" data-atk-rate-kids'+(mode==='children'?'':' hidden')+'>'+
   Array.from({length:Math.max(4,kids.length)},(_,i)=>'<label class="atk-level-field">'+(i+1)+'人目<input type="number" inputmode="decimal" min="0" step="any" data-atk-level-kid="'+i+'" value="'+esc(kids[i]==null?'':amount(kids[i]))+'"><span>'+pu+'</span></label>').join('')+
  '</div><p class="atk-level-note atk-level-rate-sum" role="status" aria-live="polite" data-atk-rate-sum>'+esc(rateSummary(mode,track?amount(track.perDay):'',kids.map(amount),pu))+'</p></fieldset>';
}
function rateSummary(mode,day,kids,pu){
 const filled=kids.filter(v=>v!==''&&v!=null);
 if(mode==='children'){
  const sum=L.combinedPerDay(filled.map(Number));
  return sum==null?'子どもごとの量を入れると、合計を計算します。':'計算に使う量：1日'+amount(sum)+pu+'（'+filled.join('＋')+'）';
 }
 const d=Number(day);
 return (day!==''&&Number.isFinite(d)&&d>0?'計算に使う量：1日'+amount(d)+pu+'（合計で入力）':'1日に使う量を入れてください。')+
  (filled.length?'。子どもごとの量（'+filled.join('＋')+'）は消さずに残しています（今は使いません）':'');
}
function readRate(fs){
 const mode=fs.querySelector('[data-atk-rate-mode]:checked')?.value||'total';
 const day=fs.querySelector('[data-atk-level-edit-day],[data-atk-level-per-day]')?.value??'';
 const kids=[...fs.querySelectorAll('[data-atk-level-kid]')].map(i=>i.value===''?null:Number(i.value));
 return {mode,perDay:day===''?null:day,perChild:kids};
}
function refreshRate(fs){
 const r=readRate(fs),pu=fs.querySelector('[data-atk-level-kid]')?.nextElementSibling?.textContent||'';
 fs.querySelector('[data-atk-rate-total]').hidden=r.mode!=='total';
 fs.querySelector('[data-atk-rate-kids]').hidden=r.mode!=='children';
 fs.querySelector('[data-atk-rate-sum]').textContent=rateSummary(r.mode,r.perDay??'',r.perChild.map(v=>v==null?'':String(v)),pu);
}
doc.addEventListener('input',e=>{const fs=e.target.closest?.('[data-atk-rate]');if(fs)refreshRate(fs)});
doc.addEventListener('change',e=>{const fs=e.target.closest?.('[data-atk-rate]');if(fs)refreshRate(fs)});
// Display only (the stored value is never rewritten here): an amount saved by an older build through a
// stepping input can be a single-precision artefact such as 5.599999904632568; show it as 5.6.
const amount=n=>{const v=Number(n);return Number.isFinite(v)?String(Math.round(v*100)/100):''};
function settingsText(track,unit){
 const parts=[];
 if(track.perPack)parts.push('1'+(unit.container||'袋')+track.perPack+unit.piece);
 parts.push('1日'+amount(track.perDay)+unit.piece+(track.rateMode==='children'?'（子どもごと：'+track.perChild.map(amount).join('＋')+'）':'（合計で入力）'));
 return '設定：'+parts.join('・');
}
function sectionHTML(x){
 const id=Number(x.id),t=today(),d=L.displayLevel(x,t),e=L.estimate(x,t),track=L.readTrack(x.track),u=L.units(x);
 // Text for the estimate: bags/boxes counted as containers, pieces inside (枚/個).
 const unit={container:u.container?u.unit:'',piece:track?.pieceUnit||u.piece},pu=esc(unit.piece);
 const src=d.source==='manual'?'（自分で設定）':d.source==='estimate'?'（見積もり）':d.source==='count'?'（在庫数から）':'';
 const btn=(lv)=>'<button type="button" data-atk-level-set="'+lv+'" aria-pressed="'+(x.level===lv)+'">'+esc(L.LABEL[lv])+'</button>';
 return '<section class="atk-level" data-atk-level-id="'+id+'" aria-label="残りの目安">'+
  '<div class="atk-level-head"><b>かんたん管理</b><span class="atk-level-now">今：'+esc(d.label)+esc(src)+'</span></div>'+
  '<div class="atk-level-buttons" role="group" aria-label="残りの目安を選ぶ">'+L.LEVELS.map(btn).join('')+'</div>'+
  (x.level?manualNote(x,t)+'<button type="button" class="atk-level-link" data-atk-level-clear>自分で選んだ目安を外す</button>':'')+
  '<details class="atk-level-detail"'+(track?' open':'')+'><summary>詳しく管理する（任意）</summary>'+
  (track?'<p class="atk-level-estimate" role="status">'+esc(estimateText(e,unit))+'</p>'+
    '<div class="atk-level-fix" role="group" aria-label="見積もりを直す"><button type="button" data-atk-level-fix="still">まだある</button><button type="button" data-atk-level-fix="usedUp">使い切った</button><button type="button" data-atk-level-fix="later">後で確認</button></div>'+
    '<details class="atk-level-edit"><summary>設定を変える（1袋の数・1日の量）</summary><p class="atk-level-note">'+esc(settingsText(track,unit))+'</p>'+
     (u.container?'<label class="atk-level-field">1'+esc(u.unit)+'あたり<input type="number" inputmode="numeric" min="1" step="1" data-atk-level-edit-pack value="'+esc(track.perPack??'')+'"><span>'+pu+'</span></label>':'')+
     rateHTML('edit',id,track,pu)+
     '<button type="button" class="btn atk-level-start" data-atk-level-edit>この設定に変える</button><p class="atk-level-note">今日の見積もりから新しい設定で数え直します。</p></details>'+
    (fixUndoable(x)?'<button type="button" class="atk-level-link" data-atk-level-undo>'+(lastFix.kind==='edit'?'変える前の設定に戻す':'直す前の見積もりに戻す')+'</button>':'')+
    '<label class="atk-level-field">残り（わかれば）<input type="number" inputmode="decimal" min="0" step="1" data-atk-level-left placeholder="未入力でもOK"><span>'+pu+'</span></label>'+
    '<button type="button" class="atk-level-link" data-atk-level-stop>見積もりをやめる</button>'
   :'<p class="atk-level-note">入れた数から、毎日入力しなくても残りを見積もります。見積もりは実際の在庫数を変えません。</p>'+
    (u.container?'<label class="atk-level-field">'+esc(u.unit)+'の数<input type="number" inputmode="numeric" min="0" step="1" data-atk-level-packs value="'+esc(Number.isSafeInteger(Number(x.qty))?x.qty:'')+'"><span>'+esc(u.unit)+'</span></label>'+
     '<label class="atk-level-field">1'+esc(u.unit)+'あたり<input type="number" inputmode="numeric" min="1" step="1" data-atk-level-per-pack placeholder="例：60"><span>'+pu+'</span></label>'
     :'<label class="atk-level-field">今の残り<input type="number" inputmode="decimal" min="0" step="1" data-atk-level-units value="'+esc(Number.isFinite(Number(x.qty))?x.qty:'')+'"><span>'+pu+'</span></label>')+
    rateHTML('start',id,null,pu)+
    '<label class="atk-level-field">補充ライン<input type="number" inputmode="numeric" min="1" max="60" step="1" data-atk-level-refill value="'+L.DEFAULT_REFILL_DAYS+'"><span>日前</span></label>'+
    '<button type="button" class="btn atk-level-start" data-atk-level-start>この内容で見積もる</button>')+
  '</details><p class="atk-level-error" role="alert" hidden></p></section>';
}
function paint(id){
 const sheet=doc.getElementById('sheet'),x=find(id);
 if(!sheet||!x||!sheet.querySelector('[data-atk-detail-id="'+Number(id)+'"]'))return;
 sheet.querySelector('.atk-level')?.remove();
 const anchor=sheet.querySelector('.atk-detail-actions');
 const wrap=doc.createElement('div');wrap.innerHTML=sectionHTML(x);
 if(anchor)anchor.after(wrap.firstElementChild);else sheet.append(wrap.firstElementChild);
}
const baseShow=root.atkShowDetail;
if(typeof baseShow==='function')root.atkShowDetail=function(id,...rest){const r=baseShow.call(this,id,...rest);try{paint(id)}catch(e){console.error('あとこれ: かんたん管理',e)}return r};

doc.addEventListener('click',event=>{
 const t=event.target.closest?.('[data-atk-level-set],[data-atk-level-clear],[data-atk-level-start],[data-atk-level-fix],[data-atk-level-stop],[data-atk-level-undo],[data-atk-level-edit]');if(!t)return;
 const box=t.closest('[data-atk-level-id]');if(!box)return;
 const id=Number(box.dataset.atkLevelId),x=find(id);if(!x)return;
 const val=s=>{const v=box.querySelector(s)?.value;return v===''||v==null?null:Number(v)};
 if(t.hasAttribute('data-atk-level-set')){
  const r=L.setLevel(t.dataset.atkLevelSet,Date.now());if(r.error)return error(id,r.error);
  if(update(id,item=>Object.assign(item,r.patch)))paint(id);return;
 }
 if(t.hasAttribute('data-atk-level-clear')){if(update(id,item=>Object.assign(item,L.clearLevel().patch)))paint(id);return}
 if(t.hasAttribute('data-atk-level-start')){
  const u=L.units(x),rate=readRate(box.querySelector('.atk-level-detail > [data-atk-rate]')),common={...rate,refillDays:val('[data-atk-level-refill]')??L.DEFAULT_REFILL_DAYS,size:x.size||null,pieceUnit:u.piece,today:today(),now:Date.now(),seen:L.seenKeys(x)};
  // Bags/boxes: the number of containers (prefilled with the counted stock) × pieces in one.
  const r=u.container?(val('[data-atk-level-per-pack]')==null?{error:'1'+u.unit+'あたりの'+u.piece+'数を入力してください'}
    :L.startTrack({...common,packs:val('[data-atk-level-packs]')??0,perPack:val('[data-atk-level-per-pack]')}))
   :L.startTrack({...common,units:val('[data-atk-level-units]')});
  if(r.error)return error(id,r.error);
  if(update(id,item=>{item.track=r.track;tidy(item)}))paint(id);return;
 }
 if(t.hasAttribute('data-atk-level-edit')){
  const ed=box.querySelector('.atk-level-edit'),rate=readRate(ed.querySelector('[data-atk-rate]'));
  const r=L.editTrack(x,{perPack:ed.querySelector('[data-atk-level-edit-pack]')?.value??null,...rate,today:today(),now:Date.now()});
  if(r.error)return error(id,r.error);
  const before=x.track,was=L.readTrack(before)?.rateMode;
  const save=()=>{
   if(!update(id,item=>{item.track=r.track;tidy(item)}))return;
   // Any settings change can be put back once, while nothing else changed the estimate.
   lastFix={id,kind:'edit',before:JSON.parse(JSON.stringify(before)),after:JSON.parse(JSON.stringify(r.track))};
   paint(id);
  };
  const ask=root.AtokoreConfirm?.ask;
  if(was&&was!==rate.mode&&typeof ask==='function'){
   const unit=L.units(x).piece,kids=(r.track.perChild||[]).map(amount).join('＋');
   ask('1日の量の入れ方を変えますか？',(rate.mode==='children'?'「子どもごと」に変えます。計算に使う量は1日'+amount(r.track.perDay)+unit+'（'+kids+'）になります。':'「合計を直接入れる」に変えます。計算に使う量は1日'+amount(r.track.perDay)+unit+'になります。'+(kids?'子どもごとの量（'+kids+'）は消さずに残します。':''))+'変えた後も「変える前の設定に戻す」で戻せます。','変える').then(ok=>{if(ok)save()});
   return;
  }
  save();return;
 }
 if(t.hasAttribute('data-atk-level-stop')){if(update(id,item=>{item.track=undefined}))paint(id);return}
 if(t.hasAttribute('data-atk-level-undo')){
  if(!fixUndoable(x)){lastFix=null;paint(id);return}
  const back=lastFix.before;
  if(update(id,item=>{item.track=back})){lastFix=null;paint(id)}
  return;
 }
 if(t.hasAttribute('data-atk-level-fix')){
  const kind=t.dataset.atkLevelFix,r=L.correct(x.track,kind,{today:today(),remaining:val('[data-atk-level-left]'),now:Date.now(),seen:L.seenKeys(x)});
  if(r.error)return error(id,r.error);
  const before=x.track;
  if(!update(id,item=>{item.track=r.track;tidy(item)}))return;
  lastFix=kind==='later'?null:{id,before:JSON.parse(JSON.stringify(before)),after:JSON.parse(JSON.stringify(r.track))};
  paint(id);
  // The person's statement may also correct the counted stock, but only when they confirm it.
  if(kind==='usedUp'&&Number(x.qty)>0){
   const ask=root.AtokoreConfirm?.ask;
   const go=()=>{if(update(id,item=>{item.qty=0}))root.atkShowDetail?.(id)};
   if(typeof ask==='function')ask('在庫数も0にしますか？','見積もりは0から数え直しました。実際の在庫数（'+x.qty+(x.unit||'個')+'）も0にする場合は「0にする」を押してください。','0にする').then(ok=>{if(ok)go()});
  }
 }
});
// 「買った」 (one row or several): the existing purchase owner updates the counted stock; then each
// product with a detailed estimate gets the same amount once (key = the shopping rows bought), and
// its base date moves to today. The undo bar (polish-v44, wrapped around this) reverts it.
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};
function buyIds(){try{return Array.isArray(buys)?buys.map(b=>String(b.id)):[]}catch(_){return []}}
for(const name of ['buyOneToStockV125H','bought']){
 const original=root[name];if(typeof original!=='function')continue;
 root[name]=function(...args){
  const qty=new Map(list().map(x=>[String(x.id),Number(x.qty)])),rows=buyIds();
  const hh=root.AtokoreHousehold,shared=hh?.homeState?.().joined&&typeof hh.sharedIdFor==='function'?id=>hh.sharedIdFor('buy',id):null;
  const ids=shared?new Map(rows.map(id=>[id,shared(id)])):null;
  const result=original.apply(this,args);
  const left=new Set(buyIds()),gone=rows.filter(id=>!left.has(id));
  if(!gone.length)return result;
  // Unique per purchase on this phone (local row ids can repeat on another phone), stable for
  // every resend of the same purchase because the field and its value are written once here.
  // While sharing, the key is the shared shopping rows: two phones that both mark the SAME row as
  // bought are one purchase for the server (one restock) and one field here. Otherwise the key is
  // unique per purchase on this phone (local row ids can repeat on another phone).
  const sids=ids?gone.map(id=>ids.get(id)):[];
  const key=sids.length&&sids.every(Boolean)?'sb:'+hash(sids.sort().join(',')):'buy:'+hash(gone.sort().join(','))+':'+Date.now().toString(36)+Math.floor(Math.random()*1679616).toString(36),day=today(),undo=[];
  for(const x of list()){
   if(!x.track||!qty.has(String(x.id)))continue;
   const delta=Number(x.qty)-qty.get(String(x.id));if(!(delta>0))continue;
   // Each purchase is its own field: two phones buying at once both count; a resend adds nothing.
   const p=L.purchaseEntry(x,delta,{today:day,key:key.startsWith('sb:')?key:key+':'+x.id});
   if(!p||L.readEntry(x[p.field])?.k===p.entry.k)continue;
   undo.push([x,p.field,x[p.field]]);x[p.field]=p.entry;
  }
  if(undo.length){
   if(typeof root.save==='function'&&root.save()===false){
    for(const [x,f,old] of undo){if(old===undefined)delete x[f];else x[f]=old}
    notice('買った分を見積もりに保存できませんでした。在庫数は更新済みです。空き容量を確認してください。');
   }
   try{root.renderStock?.();root.renderHome?.()}catch(e){console.error('あとこれ: 在庫表示',e)}
  }
  return result;
 };
}
/** Set or clear the person's level for one product from anywhere (stock list badges). */
function setLevelFor(id,level){
 const r=level?L.setLevel(level,Date.now()):L.clearLevel();if(r.error)return false;
 return update(id,item=>Object.assign(item,r.patch));
}
/** Put back exactly what was there before (level and its date), e.g. after a mistaken tap. */
function restoreLevel(id,level,levelAt){
 if(level!=null&&!L.LEVELS.includes(level))return false;
 return update(id,item=>{item.level=level??undefined;item.levelAt=level?levelAt:undefined});
}
root.AtokoreStockLevelsUI=Object.freeze({sectionHTML,estimateText,manualState,setLevelFor,restoreLevel,today});
})(typeof globalThis!=='undefined'?globalThis:this);
