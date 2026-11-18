/* Atokore v39 first run: start with up to 5 everyday products, no account and no required fields.
 * Shown on the home screen until explicitly dismissed; a single saved item never auto-finishes setup.
 * Saving goes through the shared review screen (AtokoreQuickAdd), so it is saved once, with the same
 * save-failure protection as every other add. An optional reorder line per product sets minQty.
 * Progress is remembered on this device only (never sent anywhere), and only after the person acts:
 * opening the app writes nothing.
 */
(function(root){
'use strict';
const KEY='atokoreOnboardingV1',DATA_KEY='atokoreTrialV4';
const MAX=5;
// name, category, unit: common products in families with small children, then any household.
// Detailed baby products use the existing brand/product picker instead of a
// generic unnamed row in the five-item batch.
const GUIDES=[
 ['diaper','🧷 おむつ','メーカー・タイプ・サイズ'],
 ['milk','🍼 ミルク','商品・種類'],
 ['wipes','🧻 おしりふき','メーカー・商品'],
 ['food','🥣 離乳食','メーカー・月齢・商品'],
];
const CHOICES=[
 ['トイレットペーパー','日用品','パック','🧻'],['ティッシュ','日用品','箱','🤧'],['洗濯洗剤','日用品','本','🧺'],
 ['食器用洗剤','日用品','本','🍽️'],['牛乳','食料品','本','🥛'],['卵','食料品','パック','🥚'],['お米','食料品','袋','🍚'],
];
const doc=typeof document!=='undefined'?document:null;
const $=id=>doc?doc.getElementById(id):null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let picked=[],mins={},busy=false;

function readState(){try{const v=JSON.parse(root.localStorage.getItem(KEY)||'null');return v&&typeof v==='object'?v:{}}catch(e){return {}}}
function writeState(patch){const next={...readState(),...patch,v:1};try{root.localStorage.setItem(KEY,JSON.stringify(next))}catch(e){}return next}
function list(name){try{const v=root[name]??(name==='items'?items:name==='buys'?buys:undefined);return Array.isArray(v)?v:[]}catch(e){return []}}
// A first run: nothing saved yet (the app then shows its built-in examples), or everything emptied.
function eligible(){
 const s=readState();
 if(s.doneAt||s.dismissedAt||root.__atokoreStorageLock)return false;
 let saved=null;try{saved=root.localStorage.getItem(DATA_KEY)}catch(e){return false}
 // Once a person starts the guide, keep it accessible across saves and reloads.
 if(s.startedAt)return true;
 return saved===null||(list('items').length===0&&list('buys').length===0);
}
// Products already in stock are not offered again (adding them would add to the existing count).
const same=s=>String(s||'').normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/\s/g,'');
function available(){const have=new Set(list('items').map(x=>same(x.name)));return CHOICES.filter(c=>!have.has(same(c[0])))}
// Entries for the review screen; quantities can still be changed there.
function entries(names){return names.map(n=>CHOICES.find(c=>c[0]===n)).filter(Boolean).map(([name,cat,unit])=>({name,cat,unit,qty:1}))}
function reorderLine(v){const s=String(v??'').trim();if(s==='')return null;const n=Number(s);return Number.isSafeInteger(n)&&n>=0&&n<=9999?n:undefined}

function cardHTML(){
 const chips=available().map(([name,,unit,icon])=>{const on=picked.includes(name);return '<button type="button" class="atk-ob-chip'+(on?' on':'')+'" aria-pressed="'+on+'" data-ob-pick="'+esc(name)+'"><span aria-hidden="true">'+icon+'</span>'+esc(name)+'</button>'}).join('');
 const lines=picked.map(name=>{const unit=CHOICES.find(c=>c[0]===name)[2];return '<label class="atk-ob-line"><span>'+esc(name)+'</span><span class="atk-ob-line-input">残り<input type="number" min="0" max="9999" step="1" inputmode="numeric" placeholder="1" aria-label="'+esc(name)+'の補充の目安" data-ob-min="'+esc(name)+'" value="'+esc(mins[name]??'')+'">'+esc(unit)+'以下で知らせる</span></label>'}).join('');
 const progress=readState().lastSavedAt?'<p class="atk-ob-success">登録できました。続けて別の商品も登録できます。終わったら「案内を終了する」を押してください。</p>':'';
 return '<section id="atkOnboarding" class="atk-ob" aria-labelledby="atkObTitle">'+progress+
  '<h3 id="atkObTitle">まずは、よく使うストックを登録しましょう</h3>'+
  '<p class="atk-ob-sub">おむつ・ミルク・おしりふき・離乳食は、メーカーやサイズまで選んで登録できます。商品を選ぶだけでは保存されません。</p>'+
  '<div class="atk-ob-guides" role="group" aria-label="メーカー・サイズから商品を選んで登録">'+GUIDES.map(([id,name,detail])=>'<button type="button" class="atk-ob-guide" data-ob-guide="'+esc(id)+'"><strong>'+esc(name)+'</strong><small>'+esc(detail)+'から選ぶ</small></button>').join('')+'</div>'+
  '<p class="atk-ob-sub atk-ob-batch-label">または、日用品・食品をまとめて登録（'+MAX+'つまで）</p>'+
  '<div class="atk-ob-chips" role="group" aria-label="よく使う日用品・食品">'+chips+'</div>'+
  (picked.length?'<details class="atk-ob-more"><summary>補充の目安を決める（任意）</summary><p class="atk-ob-note">空欄なら残り1以下で「要補充」に出ます。</p>'+lines+'</details>':'')+
  '<p id="atkObError" class="atk-ob-error" role="alert" hidden></p>'+
  '<div class="atk-ob-actions"><button type="button" class="atk-ob-primary" data-ob-go'+(picked.length?'':' disabled')+'>'+(picked.length?'選んだ'+picked.length+'つを確認する':'商品を選んでください')+'</button>'+
  '<button type="button" class="atk-ob-later" data-ob-later>'+(readState().lastSavedAt?'案内を終了する':'自分で登録する')+'</button></div></section>';
}
function tipHTML(){
 const share=!!root.AtokoreHousehold?.open;
 return '<section id="atkOnboardingTip" class="atk-ob atk-ob-tip" aria-label="使い方">'+
  '<h3>登録できました</h3>'+
  '<p class="atk-ob-sub">使ったら「−」で減らすだけ。目安以下になった商品はホームの「気になるストック」に出て、買い物リストへ追加できます。</p>'+
  (share?'<p class="atk-ob-sub">家族にも同じ在庫を見てもらうには、家族共有から招待できます（限定テスト）。</p>':'')+
  '<div class="atk-ob-actions">'+(share?'<button type="button" class="atk-ob-primary" data-ob-share>家族を招待する</button>':'')+
  '<button type="button" class="atk-ob-later" data-ob-tip-ok>OK</button></div></section>';
}
function paint(){
 const home=$('pg-home');if(!home)return;
 const old=$('atkOnboarding'),oldTip=$('atkOnboardingTip'),oldReopen=$('atkObReopen'),s=readState();
 const showCard=eligible(),showTip=!!s.doneAt&&!s.tipSeenAt;
 if(!showCard&&old)old.remove();
 if(!showTip&&oldTip)oldTip.remove();
 if(showCard){oldReopen?.remove();}
 else if((s.doneAt||s.dismissedAt)&&!oldReopen){
  const link=doc.createElement('button');link.type='button';link.id='atkObReopen';link.className='atk-ob-reopen';link.dataset.obReopen='';link.textContent='商品登録ガイドをもう一度開く';
  const at=home.querySelector('.atk-actions')||home.firstElementChild;
  if(at)at.before(link);else home.prepend(link);
 }
 const anchor=home.querySelector('.atk-actions')||home.firstElementChild;
 if(showCard){
  const wrap=doc.createElement('div');wrap.innerHTML=cardHTML();const card=wrap.firstElementChild;
  // Keep an open "reorder line" section open while the card redraws.
  if(old?.querySelector('details[open]'))card.querySelector('details')?.setAttribute('open','');
  if(old)old.replaceWith(card);else if(anchor)anchor.before(card);else home.prepend(card);
 }else if(showTip&&!oldTip){
  const wrap=doc.createElement('div');wrap.innerHTML=tipHTML();const tip=wrap.firstElementChild;
  if(anchor)anchor.before(tip);else home.prepend(tip);
 }
}
function error(text){const e=$('atkObError');if(e){e.textContent=text;e.hidden=!text}}
function go(){
 if(busy||!picked.length)return;
 const qa=root.AtokoreQuickAdd;
 if(!qa?.openWithEntries){error('この版では確認画面を開けません。「自分で登録する」から追加してください');return}
 const lines={};
 for(const name of picked){const v=reorderLine(mins[name]);if(v===undefined){error(name+'の補充の目安は0〜9999の整数で入力してください（空欄でも大丈夫です）');return}if(v!==null)lines[name]=v}
 error('');
 const chosen=picked.slice();
 // Saved only by the review screen's final button; the reorder lines are written right after.
 qa.openWithEntries(entries(chosen),'stock',{onSaved:({byLine,lines:saved,destination})=>{
  // The review screen lets the person switch the destination to the shopping list.
  // Products saved there are not stock: no reorder line is applied and the first-run
  // stock setup is not recorded as done (same rule as the guided baby/food route).
  if(destination!=='stock'){picked=[];mins={};return}
  saved.forEach((line,i)=>{
   const id=byLine[i],it=id==null?null:list('items').find(x=>String(x.id)===String(id));
   if(it&&Object.prototype.hasOwnProperty.call(lines,line.name)&&it.minQty==null)it.minQty=lines[line.name];
  });
  if(Object.keys(lines).length&&typeof root.save==='function'&&root.save()===false)throw Error('reorder lines not saved');
  writeState({startedAt:readState().startedAt||new Date().toISOString(),lastSavedAt:new Date().toISOString(),chosen:chosen.length,reorderLines:Object.keys(lines).length});
  picked=[];mins={};
 }});
}
function onClick(event){
 const t=event.target.closest?.('[data-ob-reopen],[data-ob-guide],[data-ob-pick],[data-ob-go],[data-ob-later],[data-ob-tip-ok],[data-ob-share]');if(!t)return;
 if(t.hasAttribute('data-ob-reopen')){
  writeState({startedAt:new Date().toISOString(),doneAt:null,dismissedAt:null,tipSeenAt:new Date().toISOString()});
  paint();return;
 }
 if(t.hasAttribute('data-ob-guide')){
  const kind=t.getAttribute('data-ob-guide');
  if(!GUIDES.some(x=>x[0]===kind))return;
  if(picked.length){error('選択中の日用品・食品がまだ保存されていません。先に「選んだ商品を確認する」から登録してください。');return}
  const opened=root.AtokoreQuickAdd?.openGuidedProduct?.(kind,{onSaved:({destination,lines})=>{
   // The first-run card introduces STOCK management. A deliberate change of
   // destination to the shopping list must not be reported as stock onboarding.
   if(destination!=='stock'||!Array.isArray(lines)||!lines.length)return;
   writeState({startedAt:readState().startedAt||new Date().toISOString(),lastSavedAt:new Date().toISOString(),chosen:lines.length,guided:kind});
   picked=[];mins={};
  }});
  if(!opened){error('追加予定の商品がある場合は先に保存・取り消ししてください。その後もう一度お試しください。');return}
  writeState({startedAt:readState().startedAt||new Date().toISOString()});
  error('');return;
 }
 if(t.hasAttribute('data-ob-pick')){
  const name=t.getAttribute('data-ob-pick');
  if(picked.includes(name))picked=picked.filter(n=>n!==name);
  else if(picked.length>=MAX){error('最初は'+MAX+'つまでです。ほかの商品はあとから追加できます');return}
  else picked.push(name);
  writeState({startedAt:readState().startedAt||new Date().toISOString()});
  error('');paint();
  doc.querySelector('[data-ob-pick="'+CSS.escape(name)+'"]')?.focus();
  return;
 }
 if(t.hasAttribute('data-ob-go'))return go();
 if(t.hasAttribute('data-ob-later')){
  const s=readState(),now=new Date().toISOString();
  writeState(s.lastSavedAt?{doneAt:now,tipSeenAt:now}:{dismissedAt:now});picked=[];mins={};paint();return;
 }
 if(t.hasAttribute('data-ob-tip-ok')){writeState({tipSeenAt:new Date().toISOString()});paint();return}
 if(t.hasAttribute('data-ob-share')){writeState({tipSeenAt:new Date().toISOString()});paint();root.AtokoreHousehold?.open?.();}
}
function onInput(event){const t=event.target;if(t?.hasAttribute?.('data-ob-min'))mins[t.getAttribute('data-ob-min')]=t.value}

const api=Object.freeze({CHOICES,GUIDES,MAX,entries,reorderLine,eligible,available,state:readState});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreOnboarding=api;
if(doc&&typeof window!=='undefined'){
 doc.addEventListener('click',onClick);
 doc.addEventListener('input',onInput);
 const base=root.renderHome;
 if(typeof base==='function')root.renderHome=function(...args){const r=base.apply(this,args);try{paint()}catch(e){console.error('あとこれ: はじめの案内',e)}return r};
 paint();
}
})(typeof globalThis!=='undefined'?globalThis:this);
