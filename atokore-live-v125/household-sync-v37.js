/* Atokore household sharing — limited test (trial only).
 * Off unless window.ATOKORE_HOUSEHOLD_CONFIG = {url, anonKey} points at the trial's own Supabase
 * project (household-config-v37.js). Without it nothing is shown and nothing is sent anywhere.
 * Only the public anon key lives in the browser; every server rule is in the database functions.
 * The app keeps saving locally as before; household-core-v37.js turns saved changes into operations.
 * Photos stay on this device in this test and are not shared.
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const cfg=root.ATOKORE_HOUSEHOLD_CONFIG;
const core=root.AtokoreHouseholdCore;
const DATA_KEY='atokoreTrialV4',META_KEY='atokoreHouseholdSyncV1',SESSION_KEY='atokoreHouseholdSessionV1';
const BEFORE_SHARE=DATA_KEY+'BeforeShare';
function validConfig(c){
 if(!c||typeof c.url!=='string'||typeof c.anonKey!=='string'||!c.anonKey)return false;
 try{const u=new URL(c.url);return u.protocol==='https:'||((u.hostname==='127.0.0.1'||u.hostname==='localhost')&&u.protocol==='http:')}catch(e){return false}
}
if(!doc||!core||!validConfig(cfg))return;
const base=cfg.url.replace(/\/+$/,'');
const $=id=>doc.getElementById(id);
const store=()=>{try{return root.localStorage}catch(e){return null}};
const readJSON=k=>{try{return JSON.parse(store()?.getItem(k)||'null')}catch(e){return null}};
function writeJSON(k,v){try{const s=JSON.stringify(v);store().setItem(k,s);return store().getItem(k)===s}catch(e){return false}}
const notice=m=>{try{root.notifyAtokoreV125H?root.notifyAtokoreV125H(m):root.alert?.(m)}catch(e){}};

let meta=readJSON(META_KEY)||{};
if(!meta.device){meta.device='web-'+core.newSid('d').slice(2,12);writeJSON(META_KEY,meta)}
let session=readJSON(SESSION_KEY);
let household=meta.household||null,engine=null,syncing=null,lastRaw=null,status={state:'local'},timer=null,pending=null,puller=null;
const saveMeta=patch=>{meta={...meta,...patch};return writeJSON(META_KEY,meta)};

// ---------------------------------------------------------------- network (Supabase Auth + PostgREST RPC)
class NetError extends Error{constructor(m,code,status){super(m);this.code=code;this.status=status}}
async function request(path,body,auth){
 let res;
 try{res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.anonKey,Authorization:'Bearer '+(auth||cfg.anonKey)},body:JSON.stringify(body||{})})}
 catch(e){throw new NetError('offline','network',0)}
 const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch(e){}
 if(!res.ok)throw new NetError(data?.message||data?.msg||data?.error_description||('HTTP '+res.status),data?.code||'http',res.status);
 return data;
}
function keepSession(s){
 if(!s?.access_token||!s?.refresh_token||!s?.user?.id)throw new NetError('bad_session','auth',0);
 session={access_token:s.access_token,refresh_token:s.refresh_token,expires_at:Number(s.expires_at)||Math.floor(Date.now()/1000)+Number(s.expires_in||3600),user:{id:s.user.id,email:s.user.email||''}};
 writeJSON(SESSION_KEY,session);
}
async function refreshSession(){
 if(!session?.refresh_token)throw new NetError('signed_out','auth',401);
 keepSession(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token}));
}
async function rpc(fn,args){
 if(!session)throw new NetError('signed_out','auth',401);
 if(session.expires_at-60<Date.now()/1000)await refreshSession();
 try{return await request('/rest/v1/rpc/'+fn,args,session.access_token)}
 catch(e){if(e.status===401){await refreshSession();return request('/rest/v1/rpc/'+fn,args,session.access_token)}throw e}
}

// ---------------------------------------------------------------- engine wiring
function readState(){const s=readJSON(DATA_KEY);return s&&Array.isArray(s.items)&&Array.isArray(s.buys)&&Array.isArray(s.routines)?s:null}
function writeState(state){
 try{
  root.AtokoreDataSafety?.assertWritable?.();
  const raw=JSON.stringify(state);store().setItem(DATA_KEY,raw);
  if(store().getItem(DATA_KEY)!==raw)return false;
  lastRaw=raw;
  items=state.items;buys=state.buys;routines=state.routines;
 }catch(e){root.console?.error?.('あとこれ: 共有データを端末に保存できませんでした',e);return false}
 try{root.render?.()}catch(e){root.console?.error?.('あとこれ: 共有データの表示更新に失敗',e)}
 return true;
}
function makeEngine(){
 engine=core.createEngine({readState,writeState,readMeta:()=>meta.engine||null,writeMeta:m=>saveMeta({engine:m}),rpc,device:meta.device});
 return engine;
}
function setStatus(state,detail){status={state,detail,pending:engine?engine.status().pending:0};paint()}
async function syncNow(){
 if(!engine||!household)return status;
 if(syncing)return syncing;
 syncing=(async()=>{
  try{
   if(root.navigator&&root.navigator.onLine===false)throw new NetError('offline','network',0);
   setStatus('syncing');
   await engine.sync();
   const s=engine.status();
   setStatus(s.pending?'pending':'synced');
  }catch(e){
   if(e.code==='network')setStatus('offline');
   else if(e.code==='auth'||e.status===401)setStatus('auth');
   else if(/not_member/.test(e.message)){household=null;saveMeta({household:null});setStatus('removed')}
   else setStatus('error',e.message);
   root.console?.warn?.('あとこれ 家族共有の同期',e);
  }finally{syncing=null}
  return status;
 })();
 return syncing;
}
// Local saves are noticed by comparing the stored data; sending waits a moment to batch quick taps.
function watch(){
 clearInterval(timer);
 lastRaw=store()?.getItem(DATA_KEY)??null;
 timer=setInterval(()=>{
  if(!engine||!household)return;
  const raw=store()?.getItem(DATA_KEY)??null;
  if(raw!==lastRaw){
   lastRaw=raw;
   try{if(engine.flush())setStatus('pending')}catch(e){setStatus('error',e.message)}
   clearTimeout(pending);pending=setTimeout(syncNow,1500);
  }
 },1000);
 clearInterval(puller);puller=setInterval(()=>{if(doc.visibilityState!=='hidden')syncNow()},20000);
}
root.addEventListener?.('online',()=>syncNow());
doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')syncNow()});

// ---------------------------------------------------------------- UI helpers (DOM + textContent only)
function el(tag,props,children){
 const n=doc.createElement(tag);
 for(const [k,v] of Object.entries(props||{})){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v)}
 for(const c of children||[])if(c)n.append(c);
 return n;
}
const STATUS_TEXT={local:'共有していません',syncing:'同期しています…',synced:'家族と共有済み',pending:'送信待ちがあります',offline:'オフライン：この端末に保存済み。つながったら送ります',auth:'ログインし直してください',error:'送信に失敗しました。自動でやり直します',removed:'この世帯から外れました（端末の在庫は残っています）'};
function statusLine(){
 const s=engine?engine.status():{pending:0,rejected:0};
 let t=STATUS_TEXT[status.state]||'';
 if(s.pending&&status.state!=='synced')t+='（送信待ち '+s.pending+'件）';
 return t;
}
function paint(){
 const chip=$('atkHouseholdChip');
 if(chip){chip.hidden=!household;chip.textContent=status.state==='synced'?'共有済み':status.state==='pending'||status.state==='syncing'?'送信待ち':status.state==='offline'?'オフライン':status.state==='local'?'':'要確認';chip.dataset.state=status.state}
 const meta2=$('atkHouseholdCardMeta');if(meta2)meta2.textContent=household?statusLine():'招待した家族と在庫・買い物リストを共有（限定テスト）';
 const line=$('atkHouseholdStatus');if(line)line.textContent=statusLine();
}
function sheet(title,children){
 root.openM?.('');
 const s=$('sheet');if(!s)return null;
 const close=el('button',{type:'button',class:'close',text:'閉じる',onclick:()=>root.closeM?.()});
 s.replaceChildren(close,el('h2',{text:title}),...children.filter(Boolean));
 s.classList.add('atk-household-sheet');
 return s;
}
const note=t=>el('p',{class:'atk-hh-note',text:t});
const field=(label,input)=>el('label',{class:'atk-hh-field'},[el('span',{text:label}),input]);
const button=(text,onclick,cls='atk-hh-primary')=>el('button',{type:'button',class:cls,text,onclick});
const ERR={invalid_code:'招待コードが正しくありません',used_code:'この招待コードはすでに使われています',revoked_code:'この招待コードは無効になっています',expired_code:'招待コードの期限（24時間）が切れています',seat_limit:'無料の家族共有は2人までです',already_member:'すでに別の世帯に参加しています',too_many_attempts:'失敗が続いたため1時間ほど待ってからお試しください',offline:'通信できません。電波の良い所でお試しください'};
const friendly=e=>ERR[e?.message]||ERR[e]||('うまくいきませんでした（'+(e?.message||e)+'）');
async function busy(btn,fn){btn.disabled=true;try{return await fn()}catch(e){notice(friendly(e));root.console?.warn?.(e)}finally{btn.disabled=false}}
function backupDevice(){
 const s=readState();if(!s)return false;
 return writeJSON(BEFORE_SHARE,{at:Date.now(),data:s});
}
function downloadBackup(){
 const b=readJSON(BEFORE_SHARE);if(!b)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify({app:'atokore',format:1,exportedAt:new Date(b.at).toISOString(),data:b.data},null,1)],{type:'application/json'}));
 const a=el('a',{href:url,download:'atokore-before-share.json'});doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
const counts=s=>'在庫'+(s?.items?.length||0)+'件・買い物'+(s?.buys?.length||0)+'件・いつものリスト'+(s?.routines?.length||0)+'件';

// ---------------------------------------------------------------- screens
async function open(){
 if(!session)return signIn();
 if(!household)return chooseHousehold();
 // Joined earlier but the choice about this device's data was never made: ask again before syncing.
 if(!meta.engine?.shadow){
  try{makeEngine();engine.startAsJoiner();return await choosePlacement(await rpc('hh_my',{}))}catch(e){notice(friendly(e));return}
 }
 return dashboard();
}
function signIn(){
 const email=el('input',{type:'email',autocomplete:'email',inputmode:'email',placeholder:'you@example.com',id:'atkHhEmail'});
 const code=el('input',{type:'text',inputmode:'numeric',autocomplete:'one-time-code',maxlength:'6',placeholder:'6桁',id:'atkHhCode'});
 const step2=el('div',{class:'atk-hh-step',hidden:''},[field('メールに届いた6桁のコード',code),button('ログイン',e=>busy(e.target,async()=>{
  if(!/^\d{6}$/.test(code.value.trim()))throw 'コードは6桁の数字です';
  keepSession(await request('/auth/v1/verify',{type:'email',email:email.value.trim(),token:code.value.trim()}));
  await afterSignIn();
 }))]);
 sheet('家族共有（限定テスト）',[
  note('家族それぞれが自分のメールアドレスでログインし、同じ在庫・買い物リスト・いつものリストを使えます。無料で1世帯2人まで。写真はこの端末だけに保存され、共有されません。'),
  field('メールアドレス',email),
  button('確認コードを送る',e=>busy(e.target,async()=>{
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))throw 'メールアドレスを確認してください';
   await request('/auth/v1/otp',{email:email.value.trim(),create_user:true});
   step2.hidden=false;code.focus();notice('確認コードを送りました。メールを確認してください');
  })),step2]);
}
async function afterSignIn(){
 const my=await rpc('hh_my',{});
 if(my?.household){
  // Same account on a new or reset device: receive the household, choosing what happens to local data.
  household={id:my.household.id,name:my.household.name};saveMeta({household});
  makeEngine();engine.startAsJoiner();
  return choosePlacement(my);
 }
 chooseHousehold();
}
function chooseHousehold(){
 const name=el('input',{type:'text',maxlength:'20',placeholder:'例：ママ',id:'atkHhName'});
 const code=el('input',{type:'text',maxlength:'9',autocapitalize:'characters',placeholder:'8文字',id:'atkHhJoinCode'});
 const local=readState();
 sheet('家族共有（限定テスト）',[
  field('家族に表示される名前',name),
  el('div',{class:'atk-hh-card'},[el('h3',{text:'世帯を作って家族を招待する'}),
   note('この端末の'+counts(local)+'が、共有の最初のデータになります。共有を始める前に、この端末内に控えを保存します。'),
   button('世帯を作る',e=>busy(e.target,async()=>{
    if(!name.value.trim())throw '名前を入れてください';
    if(!root.confirm?.('この端末の'+counts(local)+'を共有の最初のデータにします。よろしいですか？'))return;
    if(!backupDevice())throw '控えを保存できなかったため中止しました（何も変更していません）';
    const my=await rpc('hh_create',{p_name:'わが家',p_display_name:name.value.trim()});
    household={id:my.household.id,name:my.household.name};saveMeta({household});
    makeEngine();engine.startAsCreator();watch();await syncNow();dashboard();
   }))]),
  el('div',{class:'atk-hh-card'},[el('h3',{text:'招待コードで参加する'}),field('家族から届いた招待コード',code),
   button('参加する',e=>busy(e.target,async()=>{
    if(!name.value.trim())throw '名前を入れてください';
    const my=await rpc('hh_join',{p_code:code.value.trim(),p_display_name:name.value.trim()});
    if(my?.error)throw my.error;
    household={id:my.household.id,name:my.household.name};saveMeta({household});
    makeEngine();engine.startAsJoiner();
    await choosePlacement(my);
   }),'atk-hh-secondary')]),
  button('ログアウト',()=>signOut(),'atk-hh-link')]);
}
// Joining with data already on this device: never replace it silently.
async function choosePlacement(my){
 const local=readState();
 const hasLocal=local&&(local.items.length||local.buys.length||local.routines.length);
 if(!hasLocal){await engine.adopt({useShared:true});watch();await syncNow();return dashboard()}
 let view={},cursor=0,more=true;
 while(more){const r=await rpc('hh_pull',{p_since:cursor});for(const x of r.records||[])view[x.kind+':'+x.id]={...x,qty:Number(x.qty)||0};cursor=Number(r.cursor)||cursor;more=!!r.more&&(r.records||[]).length>0}
 const offers=core.matchLocal(local,view);
 const rows=offers.map(o=>{
  const sel=el('select',{'data-key':o.key,'aria-label':o.name+'の扱い'});
  const opts=o.sharedId?[['skip','共有の数量を使う'],['sum','この端末の数量を足す']]:[['new','共有に追加する'],['skip','追加しない']];
  for(const [v,t] of opts)sel.append(el('option',{value:v,text:t}));
  const detail=o.sharedId?'共有にも同じ商品があります（共有 '+o.sharedQty+o.unit+'／この端末 '+o.qty+o.unit+'）':'この端末だけにある商品です（'+o.qty+o.unit+'）';
  return el('div',{class:'atk-hh-offer'},[el('strong',{text:o.name}),el('small',{text:o.kind==='buy'?'買い物リスト：'+detail:o.kind==='routine'?'いつものリスト':detail}),sel]);
 });
 const list=el('div',{class:'atk-hh-offers',hidden:''},[...rows,button('選んだ内容で共有を始める',e=>busy(e.target,async()=>{
  if(!backupDevice())throw '控えを保存できなかったため中止しました（何も変更していません）';
  await engine.adopt({add:[...list.querySelectorAll('select')].map(s=>({key:s.dataset.key,mode:s.value}))});
  watch();await syncNow();dashboard();notice('共有を始めました');
 }))]);
 sheet((my?.household?.name||'わが家')+'の共有データ',[
  note('この端末にも'+counts(local)+'があります。共有のデータと自動で混ぜたり、上書きしたりはしません。どちらかを選んでください。始める前に、この端末のデータを控えとして端末内に保存します。'),
  button('共有のデータを使う（この端末のデータは控えに保存）',e=>busy(e.target,async()=>{
   if(!root.confirm?.('この端末の在庫などは共有のデータに置き換わります。控えは「共有前の控えをファイルに保存」で取り出せます。続けますか？'))return;
   if(!backupDevice())throw '控えを保存できなかったため中止しました（何も変更していません）';
   await engine.adopt({useShared:true});watch();await syncNow();dashboard();notice('共有のデータに切り替えました');
  })),
  button('この端末の商品も共有に加える（1件ずつ選ぶ）',()=>{list.hidden=false},'atk-hh-secondary'),
  note('同じ名前・単位・カテゴリの商品だけを「同じ商品」として表示します。サイズや容量が違う商品は別の商品のままです。'),
  list]);
}
async function dashboard(){
 const statusEl=el('p',{id:'atkHouseholdStatus',class:'atk-hh-status',text:statusLine()});
 const members=el('ul',{class:'atk-hh-members'});
 const inviteBox=el('div',{class:'atk-hh-invite'});
 const history=el('ol',{class:'atk-hh-history',hidden:''});
 const rejected=engine?.meta().rejected||[];
 const s=sheet((household?.name||'わが家')+'の家族共有',[
  statusEl,members,inviteBox,
  button('今すぐ同期',e=>busy(e.target,async()=>{await syncNow();statusEl.textContent=statusLine()}),'atk-hh-secondary'),
  button('変更履歴（だれが何を変えたか）',e=>busy(e.target,async()=>{
   const rows=await rpc('hh_changes',{p_limit:50});history.replaceChildren(...(rows||[]).map(r=>el('li',{text:changeText(r)})));history.hidden=false;
  }),'atk-hh-secondary'),history,
  rejected.length?el('details',{class:'atk-hh-rejected'},[el('summary',{text:'送れなかった変更 '+rejected.length+'件（共有のデータを優先しました）'}),...rejected.slice(-10).map(r=>el('p',{text:(r.op.type)+'：'+r.status}))]):null,
  note('写真はこの端末だけに保存され、家族には共有されません。'),
  readJSON(BEFORE_SHARE)?button('共有前の控えをファイルに保存',downloadBackup,'atk-hh-link'):null,
  button('この世帯から抜ける（端末の在庫は残ります）',e=>busy(e.target,leave),'atk-hh-link'),
  button('ログアウト',()=>signOut(),'atk-hh-link')]);
 if(!s)return;
 try{
  const my=await rpc('hh_my',{});
  if(!my?.household){household=null;saveMeta({household:null});setStatus('removed');return chooseHousehold()}
  members.replaceChildren(...my.members.map(m=>el('li',{text:m.display_name+(m.role==='owner'?'（作成者）':'')+(m.is_me?'・自分':'')})));
  const free=my.members.length<my.household.seat_limit;
  inviteBox.replaceChildren(free?button('家族を招待する（招待コードを作る）',e=>busy(e.target,async()=>{
   const inv=await rpc('hh_invite_create',{});
   const until=new Date(inv.expires_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   inviteBox.replaceChildren(el('p',{class:'atk-hh-code',id:'atkHhInviteCode',text:inv.code}),note('このコードを家族に伝えてください。'+until+'まで・1回だけ使えます。'),
    root.navigator?.share?button('コードを送る',()=>root.navigator.share({text:'あとこれの家族共有の招待コード：'+inv.code}).catch(()=>{}),'atk-hh-secondary'):null,
    button('このコードを無効にする',e2=>busy(e2.target,async()=>{await rpc('hh_invite_revoke',{});inviteBox.replaceChildren(note('招待コードを無効にしました'))}),'atk-hh-link'));
  }),'atk-hh-secondary'):note('無料の家族共有は2人までです（同じ人の別の端末は人数に数えません）。'));
 }catch(e){statusEl.textContent=friendly(e)}
}
function changeText(r){
 const when=new Date(r.at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const what=r.type==='add'?(Number(r.delta)>0?'＋':'')+Number(r.delta):r.type==='set'?(r.field==='name'?'名前':r.field)+'を変更':r.type==='create'?'追加':r.type==='delete'?'削除':r.type==='complete_buy'?'買い物から在庫へ':'変更';
 return when+' '+r.who+'：'+(r.name||'（削除済み）')+' '+what;
}
async function leave(){
 if(engine)try{engine.flush()}catch(e){}
 const left=engine?engine.status().pending:0;
 if(left){try{await syncNow()}catch(e){}}
 const still=engine?engine.status().pending:0;
 if(!root.confirm?.((still?'まだ家族に送れていない変更が'+still+'件あります。抜けると家族には届きません。\n':'')+'この世帯から抜けますか？この端末の在庫はそのまま残ります。'))return;
 await rpc('hh_leave',{});
 stop();household=null;saveMeta({household:null,engine:null});setStatus('local');root.closeM?.();notice('世帯から抜けました。この端末の在庫はそのまま残っています');
}
function stop(){clearInterval(timer);clearInterval(puller);timer=puller=null;engine=null}
function signOut(){
 const left=engine?engine.status().pending:0;
 if(!root.confirm?.((left?'まだ家族に送れていない変更が'+left+'件あります。\n':'')+'ログアウトしますか？この端末の在庫はそのまま残ります。'))return;
 const token=session?.access_token;
 request('/auth/v1/logout',{},token).catch(()=>{});
 stop();session=null;household=null;try{store().removeItem(SESSION_KEY)}catch(e){}
 saveMeta({household:null,engine:null});setStatus('local');root.closeM?.();
}

function installEntry(){
 const page=$('pg-premium');
 if(page&&!$('atkHouseholdCard')){
  const card=el('button',{type:'button',id:'atkHouseholdCard',class:'row atk-household-card',onclick:open},[
   el('span',{class:'grow'},[el('span',{class:'name',text:'家族共有（限定テスト）'}),el('span',{class:'meta',id:'atkHouseholdCardMeta',text:''})]),
   el('span',{'aria-hidden':'true',text:'›'})]);
  const anchor=$('atkBackupCard')||page.querySelector('.section');
  if(anchor)anchor.after(card);else page.prepend(card);
 }
 const top=doc.querySelector('.top h1');
 if(top&&!$('atkHouseholdChip')){const chip=el('button',{type:'button',id:'atkHouseholdChip',class:'atk-household-chip',hidden:'',onclick:open});top.after(chip)}
 paint();
}

installEntry();
if(session&&household&&meta.engine?.shadow){makeEngine();watch();setStatus(engine.status().pending?'pending':'synced');syncNow()}
root.AtokoreHousehold=Object.freeze({open,syncNow,status:()=>({...status,...(engine?engine.status():{})})});
})(typeof globalThis!=='undefined'?globalThis:this);
