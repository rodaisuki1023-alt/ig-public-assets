/* Atokore v51 保育園セット: weekday, event and per-child items on top of the existing checklist.
 * - The base checklist (packing-checklist-v50.js) is untouched; this keeps its own record under a
 *   NEW key, so old data needs no migration and is never rewritten.
 * - Today's rows come from the reviewed planDay() (family-prep-v51.js): weekly rows of each child
 *   plus that child's event rows for the date (an event ADDS to the week, e.g. 遠足: お弁当).
 * - Ticks are kept per date, so tomorrow starts fresh without a reset button.
 * - Nothing here changes stock or the shopping list. 出かける前の確認 reads today's unticked rows.
 * - A change made in another tab is never overwritten: the write is refused and the screen reloads.
 * - v51 (Work 6th): the person's own list (KEY) and a household's shared list (KEY+':hh:'+id) are kept
 *   apart. Sharing never writes into the own list; leaving drops every household copy; an answer that
 *   arrives after leaving is ignored; a new household gets nothing unless the person shares their own
 *   list with the button (only their own data, never what came from another household).
 */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;
const section=doc&&doc.getElementById('atkPackingMvp');
const core=root.AtokorePrepProposal;
// Work 7th (D): #112 wrote a household's shared list into atokorePrepSetsV1, so what that key holds has no
// known origin on a phone that used family sharing. The person's own list now lives under its own key with
// its origin recorded (PROV: 'own' | 'unknown'). The old key is never deleted or rewritten; it is copied once.
const PATH_KEY=(root.location?.pathname||'/');
const LEGACY_KEY='atokorePrepSetsV1:'+PATH_KEY;
const KEY='atokorePrepOwnV2:'+PATH_KEY;
const PROV=KEY+':prov';
const DAYS=['日','月','火','水','木','金','土'];
const MAX_CHILDREN=4,MAX_ROWS=30,MAX_NAME=40;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const localDay=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>localDay(new Date());
// Yesterday on this phone's calendar (not the UTC date of 24 hours ago, which is two days back in Japan
// from 0:00 to 9:00 and dropped yesterday's ticks).
const yesterday=()=>{const d=new Date();d.setDate(d.getDate()-1);return localDay(d)};
const isDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
const empty=()=>({v:1,children:[],week:{},events:{},done:{}});

// Strict shape check: anything else is treated as unreadable and never overwritten.
function valid(s){
 const name=x=>typeof x==='string'&&x.trim().length>0&&x.length<=MAX_NAME;
 const rows=a=>Array.isArray(a)&&a.length<=MAX_ROWS&&a.every(r=>r&&typeof r.id==='string'&&r.id.length<=60&&name(r.name));
 if(!s||s.v!==1||!Array.isArray(s.children)||s.children.length>MAX_CHILDREN)return false;
 // place: the daycare/kindergarten the child goes to (optional, to tell two 園 apart).
 if(!s.children.every(c=>c&&typeof c.id==='string'&&c.id.length<=60&&name(c.name)&&(c.place==null||(typeof c.place==='string'&&c.place.length<=20))))return false;
 const ids=new Set(s.children.map(c=>c.id));if(ids.size!==s.children.length)return false;
 for(const [cid,w] of Object.entries(s.week||{})){if(!ids.has(cid)||typeof w!=='object')return false;for(const [d,r] of Object.entries(w))if(!/^[0-6]$/.test(d)||!rows(r))return false}
 for(const [cid,e] of Object.entries(s.events||{})){if(!ids.has(cid)||typeof e!=='object')return false;for(const [d,ev] of Object.entries(e))if(!isDay(d)||!ev||!rows(ev.rows)||(ev.label!=null&&!(typeof ev.label==='string'&&ev.label.length<=MAX_NAME)))return false}
 for(const [d,list] of Object.entries(s.done||{}))if(!isDay(d)||!Array.isArray(list)||list.length>200||!list.every(x=>typeof x==='string'&&x.length<=1300))return false;
 return true;
}
/** Today's rows for all children (pure; exported for tests). */
function rowsFor(state,date){
 if(!core?.planDay||!isDay(date))return [];
 const day=String(new Date(date+'T00:00:00Z').getUTCDay());
 const profiles=state.children.map(c=>{
  const weekly=state.week?.[c.id]?.[day]||[],ev=state.events?.[c.id]?.[date];
  // planDay validates rows; quantities are not asserted here (required 1 = "bring it").
  const rows=[...weekly,...(ev?.rows||[])].map(r=>({id:r.id,name:r.name,required:1,unit:'点'}));
  return {id:c.id,week:{[day]:rows}};
 });
 const names=new Map(state.children.map(c=>[c.id,c.name])),places=new Map(state.children.map(c=>[c.id,c.place||null]));
 return core.planDay(profiles,date).map(r=>({instanceId:r.instanceId,childId:r.profileId,child:names.get(r.profileId),place:places.get(r.profileId),name:r.name,
  event:state.events?.[r.profileId]?.[date]?.rows?.some(x=>x.id===r.id)?(state.events[r.profileId][date].label||'行事'):null}));
}
/** Unticked rows of today, for 出かける前の確認 (name -> number of children). */
function pendingToday(state,date){
 const done=new Set(state.done?.[date]||[]),out=new Map();
 for(const r of rowsFor(state,date))if(!done.has(r.instanceId))out.set(r.name,(out.get(r.name)||0)+1);
 return [...out].map(([name,children])=>({name,children}));
}

let state=empty(),snapshot=null,locked=false,lastError='',loadedKey=KEY;
const HKEY=id=>KEY+':hh:'+id;
// Work 8th (D): the origin of old data cannot be proven. The absence of a family-sharing trace is not proof
// (a partial restore or a lost household record removes the trace), so EVERY list that existed before
// this version - the old key, and an own list whose origin was recorded by the earlier heuristic (the
// plain strings 'own' / 'unknown') - is of unknown origin: kept and usable on this phone, never offered or
// sent to a household. Nothing ever turns unknown into own (no edit, emptying, restart, partial restore or
// account switch). Only a list started here from nothing gets a positive record:
//   PROV = {"origin":"own","owner":<the signed-in user id, or "local" when signed out>,"at":<ms>,"h":<digest>}
// and it can be shared only by that owner ("local" is bound to the first account that shares it).
// h is the digest of the list as this code last saved it: a list written by anything else (a restore, an
// older version, another app) no longer matches and is of unknown origin, whatever the record says.
const UNKNOWN=JSON.stringify({origin:'unknown'});
function digest(raw){let h=0x811c9dc5;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return raw.length.toString(36)+'.'+h.toString(36)}
function provRecord(){
 try{const raw=root.localStorage.getItem(PROV);if(raw===null)return null;const p=JSON.parse(raw);
  const list=root.localStorage.getItem(KEY);
  return p&&typeof p==='object'&&p.origin==='own'&&typeof p.owner==='string'&&p.owner.length>0&&p.owner.length<=80
   &&list!==null&&p.h===digest(list)?p:{origin:'unknown'}}
 catch(_){return {origin:'unknown'}}     // the earlier plain strings ('own' / 'unknown') or anything unreadable
}
const myId=()=>{try{const id=root.AtokoreHousehold?.myId?.();return typeof id==='string'&&id?id:null}catch(_){return null}};
// One copy of the old key to the own key, always of unknown origin. The origin is written first, so an
// interrupted copy is unknown too; it is retried on the next start (idempotent: never copied twice).
function migrateLegacy(){
 try{
  if(root.localStorage.getItem(KEY)!==null)return;
  const raw=root.localStorage.getItem(LEGACY_KEY);if(raw===null)return;
  let parsed;try{parsed=JSON.parse(raw)}catch(_){return}
  if(!valid(parsed))return;
  root.localStorage.setItem(PROV,UNKNOWN);
  root.localStorage.setItem(KEY,raw);
  if(root.localStorage.getItem(KEY)!==raw)throw Error('verify');
 }catch(e){root.console?.warn?.('あとこれ 持ち物の移行（次回やり直します）',e)}
}
function provenance(){return provRecord()?.origin==='own'?'own':'unknown'}
// May the person signed in now share the own list? Only an own list, and only its owner.
function shareableBy(user){const p=provRecord();return p?.origin==='own'&&!!user&&(p.owner===user||p.owner==='local')}
function legacyUnreadable(){try{const raw=root.localStorage.getItem(LEGACY_KEY);if(raw===null)return false;return !valid(JSON.parse(raw))}catch(_){return true}}
function load(){
 const key=activeKey();loadedKey=key;
 if(key===KEY)migrateLegacy();
 // An old list that cannot be read is kept as it is and stops the own list from being started over it.
 try{const raw=root.localStorage.getItem(key);snapshot=raw;if(raw===null){state=empty();locked=key===KEY&&legacyUnreadable();return}
  const parsed=JSON.parse(raw);if(!valid(parsed))throw Error('invalid');state=parsed;locked=false}
 // An unreadable own list is never overwritten; a household copy is only a cache of the server.
 catch(_){locked=key===KEY;state=empty()}
}
// Only data whose origin is this person on this phone can be shared; an old list of unknown origin is
// kept and usable here, but never offered or sent to a household.
function readOwn(){if(!shareableBy(myId()))return null;try{const raw=root.localStorage.getItem(KEY);if(raw===null)return null;const p=JSON.parse(raw);return valid(p)?p:null}catch(_){return null}}
function dropHouseholdCopies(except){
 try{for(const k of Object.keys(root.localStorage))if((k.startsWith(KEY+':hh:')||k.startsWith(LEGACY_KEY+':hh:'))&&k!==except)root.localStorage.removeItem(k)}
 catch(e){root.console?.warn?.('あとこれ 持ち物の家族データ削除',e)}
}
// ---- shared mode (draft server functions; only when the household has them: prepEnabled()).
// The server document is the truth; this device keeps a cache. Settings carry a revision (a stale
// phone is refused and reloads); ticks are separate, idempotent calls.
let serverRev=0,lastFetch=0,sharedBusy=false,offerOwn=false;
function sharedOn(){const h=root.AtokoreHousehold;return !!h?.prepEnabled?.()&&h.homeState?.().joined===true}
function hid(){return sharedOn()?root.AtokoreHousehold.householdId?.()||null:null}
function activeKey(){const h=hid();return h?HKEY(h):KEY}
// The household and sign-in this request belongs to; an answer for another one is dropped.
function scopeNow(){const h=root.AtokoreHousehold;return hid()+'|'+(h?.sharedEpoch?.()??0)}
const strip=x=>{const d=JSON.parse(JSON.stringify(x));delete d.done;return d};
function writeLocal(next,household){
 if(!household||hid()!==household)return false;    // left or switched meanwhile: not this household any more
 const key=HKEY(household),raw=JSON.stringify(next);
 try{root.localStorage.setItem(key,raw);if(root.localStorage.getItem(key)!==raw)throw Error('verify')}
 catch(_){lastError='この端末に保存できませんでした。空き容量を確認してください。';paint();return false}
 dropHouseholdCopies(key);
 loadedKey=key;state=next;snapshot=raw;paint();root.AtokorePackingShortage?.refresh?.();return true;
}
async function pullShared(force){
 if(!sharedOn()||sharedBusy)return;
 if(loadedKey!==activeKey())load();
 if(!force&&Date.now()-lastFetch<60000)return;
 const household=hid(),scope=scopeNow();
 sharedBusy=true;lastFetch=Date.now();
 try{
  const d=today(),r=await root.AtokoreHousehold.prepGet(d);
  if(scopeNow()!==scope)return;                       // answered after leaving / switching: ignored
  if(r?.doc){
   const next={...r.doc,done:{[d]:Array.isArray(r.ticks)?r.ticks:[]}};
   offerOwn=false;
   if(valid(next)){serverRev=Number(r.rev)||0;writeLocal(next,household)}else lastError='家族の持ち物の共有データを読めませんでした（変更はしていません）。';
  }else if(r){
   // Nothing shared in this household yet. Nothing is uploaded by itself: the person may share their
   // own list (never a list that came from another household) with the button.
   serverRev=0;offerOwn=!!readOwn()?.children?.length;
  }
 }catch(_){if(scopeNow()===scope)lastError='家族の持ち物を取得できませんでした。通信を確認してください。'}
 finally{sharedBusy=false;paint()}
}
async function shareOwn(){
 const own=readOwn(),household=hid(),scope=scopeNow();
 if(!own?.children?.length||!household)return;
 try{
  const put=await root.AtokoreHousehold.prepPut(strip(own),0);
  if(scopeNow()!==scope)return;
  if(put?.status==='ready'){
   // A list started while signed out ("local") now belongs to the account that shared it: no other
   // account on this phone can share it later.
   try{const p=provRecord();if(p?.origin==='own'&&p.owner==='local'&&myId())root.localStorage.setItem(PROV,JSON.stringify({...p,owner:myId()}))}catch(_){}   // h unchanged: the own list is not rewritten
   serverRev=put.rev;offerOwn=false;lastError='';writeLocal({...strip(own),done:{}},household);return}
  if(put?.status==='stale'){offerOwn=false;lastError='家族が先に持ち物を登録しました。家族の内容を表示しています。';await pullShared(true);return}
  lastError='入力内容を確認してください。';
 }catch(_){if(scopeNow()===scope)lastError='通信できないため共有できませんでした。つながってからお試しください。'}
 paint();
}
async function editShared(next){
 const d=today(),before=new Set(state.done[d]||[]),after=new Set(next.done[d]||[]);
 const onlyTicks=JSON.stringify(strip(next))===JSON.stringify(strip(state));
 const household=hid(),scope=scopeNow();
 try{
  if(onlyTicks){
   for(const id of after)if(!before.has(id))await root.AtokoreHousehold.prepTick(d,id,true);
   for(const id of before)if(!after.has(id))await root.AtokoreHousehold.prepTick(d,id,false);
   if(scopeNow()!==scope)return;
   lastError='';writeLocal(next,household);return;
  }
  const r=await root.AtokoreHousehold.prepPut(strip(next),serverRev);
  if(scopeNow()!==scope)return;
  if(r?.status==='ready'){serverRev=r.rev;offerOwn=false;lastError='';writeLocal(next,household);return}
  if(r?.status==='stale'){lastError='家族が先に変更しました。最新の内容を表示しています。もう一度操作してください。';await pullShared(true);return}
  lastError='入力内容を確認してください。';paint();
 }catch(_){if(scopeNow()===scope){lastError='通信できないため変更できませんでした（家族と共有中）。つながってからお試しください。';paint()}}
}
// Read-modify-write against the bytes this tab last saw; another tab's change wins and reloads.
function edit(fn){
 if(loadedKey!==activeKey())load();
 if(locked)return false;
 if(sharedOn()){
  const next=JSON.parse(JSON.stringify(state));fn(next);
  const keep=new Set([today(),yesterday()]);
  for(const d of Object.keys(next.done))if(!keep.has(d))delete next.done[d];
  if(!valid(next)){lastError='入力内容を確認してください。';paint();return false}
  void editShared(next);return true;
 }
 let current;try{current=root.localStorage.getItem(KEY)}catch(_){lastError='保存領域を読めません。';return false}
 if(current!==snapshot){load();lastError='別の画面で変更されたため、最新の内容を読み直しました。もう一度操作してください。';paint();return false}
 const next=JSON.parse(JSON.stringify(state));fn(next);
 // Keep ticks only for today and yesterday.
 const keep=new Set([today(),yesterday()]);
 for(const d of Object.keys(next.done))if(!keep.has(d))delete next.done[d];
 if(!valid(next)){lastError='入力内容を確認してください。';paint();return false}
 const raw=JSON.stringify(next);
 try{
  // Origin (Work 8th): only a list started here from nothing is the person's own. Editing or emptying a
  // list of unknown origin never changes its origin; a record that is already there is never replaced.
  // The record follows the list: written before the list (an interrupted save leaves a digest that does not
  // match -> unknown, the safe side) and only when the list was own already or is started now.
  const p=provRecord(),fresh=current===null&&p===null;
  if(fresh||p?.origin==='own')root.localStorage.setItem(PROV,JSON.stringify(fresh?{origin:'own',owner:myId()||'local',at:Date.now(),h:digest(raw)}:{...p,h:digest(raw)}));
  root.localStorage.setItem(KEY,raw);if(root.localStorage.getItem(KEY)!==raw)throw Error('verify');
 }
 catch(_){lastError='この端末に保存できませんでした。空き容量を確認してください。';paint();return false}
 state=next;snapshot=raw;lastError='';paint();root.AtokorePackingShortage?.refresh?.();return true;
}

function paint(){
 if(!section)return;
 let box=doc.getElementById('atkPrepSets');
 const open=box?box.open:false,date=today(),rows=rowsFor(state,date),done=new Set(state.done?.[date]||[]);
 if(!box){box=doc.createElement('details');box.id='atkPrepSets';box.className='atk-prep';
  (doc.getElementById('atkPackShort')||doc.getElementById('atkPackProgress')||section.firstElementChild).after(box)}
 const left=rows.filter(r=>!done.has(r.instanceId)).length;
 const dayLabel=(Number(date.slice(5,7)))+'/'+Number(date.slice(8))+'（'+DAYS[new Date(date+'T00:00:00Z').getUTCDay()]+'）';
 const kids=state.children,multi=kids.length>1;
 const todayList=rows.length?'<ul class="atk-prep-today">'+rows.map(r=>'<li><label><input type="checkbox" data-prep-tick="'+esc(r.instanceId)+'"'+(done.has(r.instanceId)?' checked':'')+(locked?' disabled':'')+'><span>'+esc(r.name)+'</span>'+
   (multi||r.event||r.place?'<small>'+esc([multi?r.child:null,r.place,r.event].filter(Boolean).join('・'))+'</small>':'')+'</label></li>').join('')+'</ul>'
  :'<p class="atk-prep-note">今日の追加はありません。曜日や行事の持ち物を下で登録できます。</p>';
 const kidLabel=c=>c.name+(c.place?'（'+c.place+'）':'');
 const childOpts=kids.map(c=>'<option value="'+esc(c.id)+'">'+esc(kidLabel(c))+'</option>').join('');
 const configured=kids.map(c=>{
  const w=state.week?.[c.id]||{},e=state.events?.[c.id]||{};
  const lines=[...Object.entries(w).filter(([,r])=>r.length).sort().map(([d,r])=>'<li><b>毎週'+DAYS[d]+'</b>'+r.map(x=>esc(x.name)+'<button type="button" class="atk-prep-del" data-prep-del-week="'+esc(c.id)+'|'+d+'|'+esc(x.id)+'" aria-label="毎週'+DAYS[d]+'の'+esc(x.name)+'を削除">×</button>').join('')+'</li>'),
   ...Object.entries(e).filter(([d])=>d>=date).sort().map(([d,ev])=>'<li><b>'+esc(d.slice(5).replace('-','/'))+(ev.label?' '+esc(ev.label):'')+'</b>'+ev.rows.map(x=>esc(x.name)+'<button type="button" class="atk-prep-del" data-prep-del-event="'+esc(c.id)+'|'+d+'|'+esc(x.id)+'" aria-label="'+esc(d)+'の'+esc(x.name)+'を削除">×</button>').join('')+'</li>')];
  return lines.length?'<div class="atk-prep-child"><p>'+esc(kidLabel(c))+'</p><ul>'+lines.join('')+'</ul></div>':'';
 }).join('');
 // A redraw (e.g. after a family update arrives) must not wipe what the person is typing.
 const typed={},focused=doc.activeElement&&box.contains(doc.activeElement)?[...doc.activeElement.attributes].find(a=>a.name.startsWith('data-prep-'))?.name:null;
 for(const el of box.querySelectorAll('input[data-prep-kid-name],input[data-prep-kid-place],input[data-prep-name],input[data-prep-label],input[data-prep-date],select[data-prep-when],select[data-prep-child]'))
  typed[[...el.attributes].find(a=>a.name.startsWith('data-prep-')).name]=el.value;
 box.innerHTML='<summary><span>曜日・行事・子どもの持ち物</span><span class="atk-prep-count">'+(rows.length?'今日 '+left+'/'+rows.length:'設定')+'</span></summary>'+
  '<div class="atk-prep-body">'+
  (locked?'<p class="atk-prep-error" role="alert">保存内容を読めないため、変更を止めています（データは消していません）。</p>':'')+
  (offerOwn&&sharedOn()?'<p class="atk-prep-note">この家族ではまだ持ち物を共有していません。この端末だけに保存していた内容（'+(readOwn()?.children?.length||0)+'人分）を共有できます。</p><button type="button" class="atk-prep-add" data-prep-share-own>この端末の内容を家族と共有する</button>':'')+
  '<p class="atk-prep-day">'+esc(dayLabel)+'の追加</p>'+todayList+
  '<div class="atk-prep-kids" role="group" aria-label="子ども">'+kids.map(c=>'<span class="atk-prep-kid">'+esc(kidLabel(c))+'<button type="button" data-prep-del-child="'+esc(c.id)+'" aria-label="'+esc(c.name)+'を削除">×</button></span>').join('')+
  (kids.length<MAX_CHILDREN?'<span class="atk-prep-addkid"><input type="text" maxlength="20" placeholder="例：上の子" aria-label="子どもの名前" data-prep-kid-name><input type="text" maxlength="20" placeholder="園の名前（任意）" aria-label="通っている園の名前（任意）" data-prep-kid-place><button type="button" data-prep-add-child>追加</button></span>':'')+'</div>'+
  (kids.length?'<div class="atk-prep-form">'+
   (multi?'<label>子ども<select data-prep-child>'+childOpts+'</select></label>':'')+
   '<label>いつ<select data-prep-when><option value="w1">毎週月曜</option><option value="w2">毎週火曜</option><option value="w3">毎週水曜</option><option value="w4">毎週木曜</option><option value="w5">毎週金曜</option><option value="w6">毎週土曜</option><option value="w0">毎週日曜</option><option value="date">日付（行事）</option></select></label>'+
   '<label class="atk-prep-date" hidden>日付<input type="date" data-prep-date></label>'+
   '<label class="atk-prep-date" hidden>行事名<input type="text" maxlength="40" placeholder="例：遠足" data-prep-label></label>'+
   '<label>持ち物<input type="text" maxlength="40" placeholder="例：シーツ" data-prep-name></label>'+
   '<button type="button" class="atk-prep-add" data-prep-add>この持ち物を追加</button></div>':'<p class="atk-prep-note">まず子どもの名前を追加してください（呼び名だけで大丈夫です）。</p>')+
  (configured?'<details class="atk-prep-list"><summary>登録した内容</summary>'+configured+'</details>':'')+
  '<p class="atk-prep-note">チェックは日ごとに自動で外れます。在庫や買い物リストは変わりません。'+(sharedOn()?'この内容とチェックは家族と共有しています。':'この内容はこの端末にだけ保存されます。')+'</p>'+
  (lastError?'<p class="atk-prep-error" role="alert">'+esc(lastError)+'</p>':'')+'</div>';
 for(const [attr,value] of Object.entries(typed)){const el=box.querySelector('['+attr+']');if(el&&value!=='')el.value=value}
 const when=box.querySelector('[data-prep-when]');if(when)for(const el of box.querySelectorAll('.atk-prep-date'))el.hidden=when.value!=='date';
 if(focused)box.querySelector('['+focused+']')?.focus();
 if(open)box.open=true;
}

if(section){
 load();
 section.addEventListener('change',e=>{
  const t=e.target;
  if(t.matches?.('[data-prep-when]')){for(const el of section.querySelectorAll('.atk-prep-date'))el.hidden=t.value!=='date';return}
  if(t.matches?.('[data-prep-tick]')){
   const id=t.getAttribute('data-prep-tick'),d=today();
   edit(n=>{const list=new Set(n.done[d]||[]);if(t.checked)list.add(id);else list.delete(id);n.done[d]=[...list]});
  }
 });
 section.addEventListener('click',async e=>{
  const t=e.target.closest?.('[data-prep-add-child],[data-prep-del-child],[data-prep-add],[data-prep-del-week],[data-prep-del-event],[data-prep-share-own]');if(!t)return;
  if(t.hasAttribute('data-prep-share-own')){t.disabled=true;await shareOwn();return}
  if(t.hasAttribute('data-prep-add-child')){
   const name=section.querySelector('[data-prep-kid-name]')?.value.trim().slice(0,20);if(!name)return;
   const place=section.querySelector('[data-prep-kid-place]')?.value.trim().slice(0,20)||'';
   section.querySelector('[data-prep-kid-name]').value='';
   const pl=section.querySelector('[data-prep-kid-place]');if(pl)pl.value='';
   edit(n=>{if(n.children.length<MAX_CHILDREN)n.children.push({id:uid('c'),name,...(place?{place}:{})})});return;
  }
  if(t.hasAttribute('data-prep-del-child')){
   const id=t.getAttribute('data-prep-del-child'),c=state.children.find(x=>x.id===id);if(!c)return;
   const ok=await root.AtokoreConfirm?.ask?.('「'+c.name+'」を削除しますか？','この子どもの曜日・行事の持ち物も削除します。持ち物チェックの基本リスト、在庫、買い物リストは変わりません。','削除する');
   if(ok)edit(n=>{n.children=n.children.filter(x=>x.id!==id);delete n.week[id];delete n.events[id]});return;
  }
  if(t.hasAttribute('data-prep-add')){
   const name=section.querySelector('[data-prep-name]')?.value.trim().slice(0,MAX_NAME);
   const when=section.querySelector('[data-prep-when]')?.value;
   const child=section.querySelector('[data-prep-child]')?.value||state.children[0]?.id;
   if(!name||!child){lastError='持ち物の名前を入力してください。';paint();return}
   section.querySelector('[data-prep-name]').value='';
   if(when==='date'){
    const d=section.querySelector('[data-prep-date]')?.value,label=section.querySelector('[data-prep-label]')?.value.trim().slice(0,MAX_NAME)||null;
    if(!isDay(d)||d<today()){lastError='今日以降の日付を選んでください。';paint();return}
    edit(n=>{n.events[child]=n.events[child]||{};const ev=n.events[child][d]||{label,rows:[]};if(label)ev.label=label;if(ev.rows.length<MAX_ROWS)ev.rows.push({id:uid('e'),name});n.events[child][d]=ev});
   }else{
    const day=String(when||'').replace('w','');if(!/^[0-6]$/.test(day))return;
    edit(n=>{n.week[child]=n.week[child]||{};const r=n.week[child][day]||[];if(r.length<MAX_ROWS)r.push({id:uid('w'),name});n.week[child][day]=r});
   }
   return;
  }
  if(t.hasAttribute('data-prep-del-week')){const [c,d,id]=t.getAttribute('data-prep-del-week').split('|');edit(n=>{const r=n.week?.[c]?.[d];if(r)n.week[c][d]=r.filter(x=>x.id!==id)});return}
  if(t.hasAttribute('data-prep-del-event')){const [c,d,id]=t.getAttribute('data-prep-del-event').split('|');edit(n=>{const ev=n.events?.[c]?.[d];if(!ev)return;ev.rows=ev.rows.filter(x=>x.id!==id);if(!ev.rows.length)delete n.events[c][d]});return}
 });
 root.addEventListener?.('storage',e=>{if(e.key===loadedKey){load();paint();root.AtokorePackingShortage?.refresh?.()}});
 section.addEventListener('toggle',e=>{if(e.target?.id==='atkPrepSets'&&e.target.open)void pullShared(true)},true);
 doc.addEventListener('atokore-household-updated',()=>{if(loadedKey!==activeKey()){load();paint();root.AtokorePackingShortage?.refresh?.()}void pullShared(false)});
 // Left, removed or signed out: no household copy stays on this phone; the own list comes back.
 doc.addEventListener('atokore-household-left',()=>{dropHouseholdCopies(null);serverRev=0;offerOwn=false;lastError='';lastFetch=0;loadedKey=null;load();paint();root.AtokorePackingShortage?.refresh?.()});
 paint();
}
root.AtokorePrepSets=Object.freeze({KEY,LEGACY_KEY,PROV,provenance,shareable:()=>shareableBy(myId()),valid,rowsFor,pendingToday,pullShared:()=>pullShared(true),pending:()=>locked?[]:pendingToday(state,today()),refresh:()=>{load();paint()}});
if(typeof module!=='undefined'&&module.exports)module.exports={valid,rowsFor,pendingToday};
})(typeof globalThis!=='undefined'?globalThis:this);
