/* Atokore v51 保育園セット: weekday, event and per-child items on top of the existing checklist.
 * - The base checklist (packing-checklist-v50.js) is untouched; this keeps its own record under a
 *   NEW key, so old data needs no migration and is never rewritten.
 * - Today's rows come from the reviewed planDay() (family-prep-v51.js): weekly rows of each child
 *   plus that child's event rows for the date (an event ADDS to the week, e.g. 遠足: お弁当).
 * - Ticks are kept per date, so tomorrow starts fresh without a reset button.
 * - Nothing here changes stock or the shopping list. 出かける前の確認 reads today's unticked rows.
 * - A change made in another tab is never overwritten: the write is refused and the screen reloads.
 */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;
const section=doc&&doc.getElementById('atkPackingMvp');
const core=root.AtokorePrepProposal;
const KEY='atokorePrepSetsV1:'+(root.location?.pathname||'/');
const DAYS=['日','月','火','水','木','金','土'];
const MAX_CHILDREN=4,MAX_ROWS=30,MAX_NAME=40;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
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

let state=empty(),snapshot=null,locked=false,lastError='';
function load(){
 try{const raw=root.localStorage.getItem(KEY);snapshot=raw;if(raw===null){state=empty();locked=false;return}
  const parsed=JSON.parse(raw);if(!valid(parsed))throw Error('invalid');state=parsed;locked=false}
 catch(_){locked=true;state=empty()}
}
// ---- shared mode (draft server functions; only when the household has them: prepEnabled()).
// The server document is the truth; this device keeps a cache. Settings carry a revision (a stale
// phone is refused and reloads); ticks are separate, idempotent calls.
let serverRev=0,lastFetch=0,sharedBusy=false;
function sharedOn(){const h=root.AtokoreHousehold;return !!h?.prepEnabled?.()&&h.homeState?.().joined===true}
const strip=x=>{const d=JSON.parse(JSON.stringify(x));delete d.done;return d};
function writeLocal(next){
 const raw=JSON.stringify(next);
 try{root.localStorage.setItem(KEY,raw);if(root.localStorage.getItem(KEY)!==raw)throw Error('verify')}
 catch(_){lastError='この端末に保存できませんでした。空き容量を確認してください。';paint();return false}
 state=next;snapshot=raw;paint();root.AtokorePackingShortage?.refresh?.();return true;
}
async function pullShared(force){
 if(!sharedOn()||sharedBusy||locked)return;
 if(!force&&Date.now()-lastFetch<60000)return;
 sharedBusy=true;lastFetch=Date.now();
 try{
  const d=today(),r=await root.AtokoreHousehold.prepGet(d);
  if(r?.doc){
   const next={...r.doc,done:{[d]:Array.isArray(r.ticks)?r.ticks:[]}};
   if(valid(next)){serverRev=Number(r.rev)||0;writeLocal(next)}else lastError='家族の持ち物の共有データを読めませんでした（変更はしていません）。';
  }else if(r&&state.children.length){
   // First phone to share: its settings become the household's (revision 0 -> 1).
   const put=await root.AtokoreHousehold.prepPut(strip(state),0);
   if(put?.status==='ready')serverRev=put.rev;else if(put?.status==='stale'){lastFetch=0;sharedBusy=false;return pullShared(true)}
  }
 }catch(_){lastError='家族の持ち物を取得できませんでした。通信を確認してください。'}
 finally{sharedBusy=false;paint()}
}
async function editShared(next){
 const d=today(),before=new Set(state.done[d]||[]),after=new Set(next.done[d]||[]);
 const onlyTicks=JSON.stringify(strip(next))===JSON.stringify(strip(state));
 try{
  if(onlyTicks){
   for(const id of after)if(!before.has(id))await root.AtokoreHousehold.prepTick(d,id,true);
   for(const id of before)if(!after.has(id))await root.AtokoreHousehold.prepTick(d,id,false);
   lastError='';writeLocal(next);return;
  }
  const r=await root.AtokoreHousehold.prepPut(strip(next),serverRev);
  if(r?.status==='ready'){serverRev=r.rev;lastError='';writeLocal(next);return}
  if(r?.status==='stale'){lastError='家族が先に変更しました。最新の内容を表示しています。もう一度操作してください。';await pullShared(true);return}
  lastError='入力内容を確認してください。';paint();
 }catch(_){lastError='通信できないため変更できませんでした（家族と共有中）。つながってからお試しください。';paint()}
}
// Read-modify-write against the bytes this tab last saw; another tab's change wins and reloads.
function edit(fn){
 if(locked)return false;
 if(sharedOn()){
  const next=JSON.parse(JSON.stringify(state));fn(next);
  const keep=new Set([today(),new Date(Date.now()-86400000).toISOString().slice(0,10)]);
  for(const d of Object.keys(next.done))if(!keep.has(d))delete next.done[d];
  if(!valid(next)){lastError='入力内容を確認してください。';paint();return false}
  void editShared(next);return true;
 }
 let current;try{current=root.localStorage.getItem(KEY)}catch(_){lastError='保存領域を読めません。';return false}
 if(current!==snapshot){load();lastError='別の画面で変更されたため、最新の内容を読み直しました。もう一度操作してください。';paint();return false}
 const next=JSON.parse(JSON.stringify(state));fn(next);
 // Keep ticks only for today and yesterday.
 const keep=new Set([today(),new Date(Date.now()-86400000).toISOString().slice(0,10)]);
 for(const d of Object.keys(next.done))if(!keep.has(d))delete next.done[d];
 if(!valid(next)){lastError='入力内容を確認してください。';paint();return false}
 const raw=JSON.stringify(next);
 try{root.localStorage.setItem(KEY,raw);if(root.localStorage.getItem(KEY)!==raw)throw Error('verify')}
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
  '<p class="atk-prep-day">'+esc(dayLabel)+'の追加</p>'+todayList+
  '<div class="atk-prep-kids" role="group" aria-label="子ども">'+kids.map(c=>'<span class="atk-prep-kid">'+esc(kidLabel(c))+'<button type="button" data-prep-del-child="'+esc(c.id)+'" aria-label="'+esc(c.name)+'を削除">×</button></span>').join('')+
  (kids.length<MAX_CHILDREN?'<span class="atk-prep-addkid"><input type="text" maxlength="20" placeholder="子どもの名前（例：上の子）" aria-label="子どもの名前" data-prep-kid-name><input type="text" maxlength="20" placeholder="園の名前（任意）" aria-label="通っている園の名前（任意）" data-prep-kid-place><button type="button" data-prep-add-child>追加</button></span>':'')+'</div>'+
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
  const t=e.target.closest?.('[data-prep-add-child],[data-prep-del-child],[data-prep-add],[data-prep-del-week],[data-prep-del-event]');if(!t)return;
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
 root.addEventListener?.('storage',e=>{if(e.key===KEY){load();paint();root.AtokorePackingShortage?.refresh?.()}});
 section.addEventListener('toggle',e=>{if(e.target?.id==='atkPrepSets'&&e.target.open)void pullShared(true)},true);
 doc.addEventListener('atokore-household-updated',()=>{void pullShared(false)});
 paint();
}
root.AtokorePrepSets=Object.freeze({KEY,valid,rowsFor,pendingToday,pullShared:()=>pullShared(true),pending:()=>locked?[]:pendingToday(state,today()),refresh:()=>{load();paint()}});
if(typeof module!=='undefined'&&module.exports)module.exports={valid,rowsFor,pendingToday};
})(typeof globalThis!=='undefined'?globalThis:this);
