/* Atokore household sharing — limited test (trial only).
 * Off unless window.ATOKORE_HOUSEHOLD_CONFIG = {url, anonKey} points at the trial's own Supabase
 * project (household-config-v37.js). Without it nothing is shown and nothing is sent anywhere.
 * Only the public anon key lives in the browser; every server rule is in the database functions.
 * The app keeps saving locally as before; household-core-v37.js turns saved changes into operations.
 * Shared photos are disabled unless the separately verified gateway is explicitly enabled.
 */
(function(root){
'use strict';
// Confirmations use the app's own dialog (native confirm() can be suppressed without UI).
const ask=(title,detail,action)=>root.AtokoreConfirm.ask(title,detail,action);
const doc=typeof document==='undefined'?null:document;
const cfg=root.ATOKORE_HOUSEHOLD_CONFIG;
const core=root.AtokoreHouseholdCore;
const DATA_KEY='atokoreTrialV4',META_KEY='atokoreHouseholdSyncV1',SESSION_KEY='atokoreHouseholdSessionV1';
const INVITE_KEY='atokoreHouseholdInviteV1';
const BEFORE_SHARE=DATA_KEY+'BeforeShare';
const RECOVERY=DATA_KEY+'SyncRecovery';
function validConfig(c){
 if(!c||typeof c.url!=='string'||typeof c.anonKey!=='string'||!c.anonKey)return false;
 try{const u=new URL(c.url);return u.protocol==='https:'||((u.hostname==='127.0.0.1'||u.hostname==='localhost')&&u.protocol==='http:')}catch(e){return false}
}
if(!doc||!core||!validConfig(cfg))return;
const base=cfg.url.replace(/\/+$/,'');
const googleAuth=cfg.google===true&&root.AtokoreGoogleAuth?root.AtokoreGoogleAuth.create({url:base,key:cfg.anonKey,storage:()=>root.localStorage,location:root.location,history:root.history,crypto:root.crypto,fetch:(...args)=>root.fetch(...args),navigate:href=>root.location.assign(href)}):null;
const $=id=>doc.getElementById(id);
const store=()=>{try{return root.localStorage}catch(e){return null}};
const readJSON=k=>{try{return JSON.parse(store()?.getItem(k)||'null')}catch(e){return null}};
function writeJSON(k,v){try{const s=JSON.stringify(v);store().setItem(k,s);return store().getItem(k)===s}catch(e){return false}}
const notice=m=>{try{root.notifyAtokoreV125H?root.notifyAtokoreV125H(m):root.alert?.(m)}catch(e){}};

let meta=readJSON(META_KEY)||{};
if(!meta.device){meta.device='web-'+core.newSid('d').slice(2,12);writeJSON(META_KEY,meta)}
let session=readJSON(SESSION_KEY);
let inviteCode='';
function rememberInvite(code){
 inviteCode=code;
 try{if(code)root.sessionStorage.setItem(INVITE_KEY,code);else root.sessionStorage.removeItem(INVITE_KEY)}catch(e){}
}
function captureInvite(initial=false){
 try{
  const u=new URL(root.location.href),hash=new URLSearchParams(u.hash.slice(1));
  const value=hash.get('invite');
  if(value!==null){
   hash.delete('invite');u.hash=hash.toString();root.history.replaceState(null,'',u.pathname+u.search+u.hash);
   rememberInvite(/^[A-HJ-NP-Z2-9]{8}$/.test(value.toUpperCase())?value.toUpperCase():'');
   return true;
  }
  if(initial){const saved=root.sessionStorage.getItem(INVITE_KEY)||'';inviteCode=/^[A-HJ-NP-Z2-9]{8}$/.test(saved)?saved:''}
 }catch(e){}
 return false;
}
captureInvite(true);
let household=meta.household||null,engine=null,syncing=null,lastRaw=null,status={state:'local'},timer=null,pending=null,puller=null;
let changes=[],historyState='loading',changesFor=null,changesRequest=null;
// Who shares this household, with the names each member set. Cached so the status stays readable
// offline; the same names are shown as the people in the change history.
// When this device started sharing with this household: local history saved before it is shown as
// "この端末・共有前の記録" (unknown for households joined before this was recorded).
function since(h){return meta.sharedFor===h?.id&&meta.sharedSince?{}:{sharedFor:h?.id,sharedSince:Date.now()}}
// Local product id for a shared record id (history rows name records by their shared id).
// The shared id of a local row while sharing (null when not shared or not yet sent).
function sharedIdFor(kind,id){
 if(!household||!session)return null;
 const map=engine?.meta?.().map||meta.engine?.map||{};
 return map[(kind==='buy'?'buy':'item')+':'+id]||null;
}
function localIdFor(kind,sid){
 const map=engine?.meta?.().map||meta.engine?.map||{};
 for(const [k,v] of Object.entries(map))if(v===sid&&k.startsWith((kind==='buy'?'buy':'item')+':'))return k.slice(k.indexOf(':')+1);
 return null;
}
function membersKey(){return household&&session?household.id+':'+session.user.id:null}
function rememberMembers(my){
 if(!Array.isArray(my?.members)||!membersKey())return;
 saveMeta({members:my.members.map(m=>({id:typeof m.user_id==='string'?m.user_id:null,name:String(m.display_name||''),me:!!m.is_me})),membersFor:membersKey(),membersAt:Date.now()});
}
async function refreshMembers(force){
 // v51 traffic: the member list changes rarely; a changed cursor forces a refresh (see syncNow).
 if(!membersKey()||(!force&&meta.membersFor===membersKey()&&Date.now()-(meta.membersAt||0)<MEMBERS_TTL))return;
 try{const my=await rpc('hh_my',{});if(my?.household)rememberMembers(my)}catch(_){}
}
const when=t=>new Date(t).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
// One summary for every place that shows the sharing state (home and the share dialog), so they
// never disagree. "Who shares" (members) and "did my changes reach them" (kind) are separate.
function shareSummary(){
 if(!household||!session)return {kind:'local',headline:'この端末だけで利用中',detail:'',members:[],me:'',pending:0,lastSync:0};
 const s=engine?engine.status():{pending:0,lastSync:0};
 const list=meta.membersFor===membersKey()&&Array.isArray(meta.members)?meta.members:[];
 const members=list.map(m=>m.name),me=list.find(m=>m.me)?.name||'',lastSync=s.lastSync||0;
 const base={members,me,pending:s.pending||0,lastSync};
 const who=members.length?'参加中：'+members.join('、')+(me?'／この端末で利用中：'+me:''):'';
 if(base.pending)return {...base,kind:'pending',headline:'家族と共有中・未送信あり',detail:'未送信の変更 '+base.pending+'件'+(who?'／'+who:'')};
 if(status.state==='synced'||(status.state==='syncing'&&lastSync))return {...base,kind:'shared',headline:members.length?members.length+'人で共有中':'家族と共有中',detail:who};
 if((status.state==='local'||status.state==='syncing')&&!lastSync)return {...base,kind:'checking',headline:'共有状態を確認しています',detail:who};
 return {...base,kind:'unknown',headline:'共有状態を確認できません',detail:(lastSync?'最後に確認した状態：'+when(lastSync)+(members.length?'・'+members.length+'人で共有中':''):'まだ共有先を確認できていません')+(STATUS_TEXT[status.state]&&status.state!=='synced'?'（'+STATUS_TEXT[status.state]+'）':'')};
}
function homeState(){
 const current=household&&session?household.id+':'+session.user.id:null;
 return {summary:shareSummary(),sharedSince:current&&meta.sharedFor===household.id?meta.sharedSince||0:0,joined:!!current,state:status.state,lastSync:engine?.status().lastSync||0,historyState:current===changesFor?historyState:'loading',changes:current===changesFor?changes.map(r=>({...r})):[]};
}
// Work 9th: the op id of a shared purchase is fixed at the moment of buying, so the estimate entry written now
// already names it (the engine uses this id for the complete_buy of that shopping row). Kept with the sync record.
// An id is used once: when the engine turns the row's purchase into a complete_buy it is consumed (moved to
// usedOps), so buying the same row again after an undo gets a NEW op id.
function purchaseOpIdFor(localBuyId,{assign=true}={}){
 const sid=sharedIdFor('buy',localBuyId);if(!sid)return null;
 const pre=meta.preOps||{},used=meta.usedOps||{};
 if(pre[sid])return pre[sid];
 if(!assign)return used[sid]||null;
 const id=root.crypto?.randomUUID?.();if(!id)return null;
 saveMeta({preOps:Object.fromEntries(Object.entries({...pre,[sid]:id}).slice(-100))});
 return id;
}
function opIdFor(buySid){
 const pre={...(meta.preOps||{})},id=pre[buySid];if(!id)return null;
 delete pre[buySid];
 saveMeta({preOps:pre,usedOps:Object.fromEntries(Object.entries({...(meta.usedOps||{}),[buySid]:id}).slice(-100))});
 return id;
}
// Only a purchase the server confirmed with a receipt can be undone in sharing (Work 9th).
function undoConfirmed(ticket){
 if(!serverUndoEstimate())return true;
 const got=new Set(engine?.meta?.().receipts||[]);
 return Array.isArray(ticket)&&ticket.length>0&&ticket.every(x=>got.has(x.op));
}
function capturePurchases(ids){
 if(!engine||!household||!session)return [];
 engine.flush();
 const m=engine.meta(),wanted=new Set(ids.map(id=>m.map['buy:'+id]));
 return m.outbox.filter(o=>o.type==='complete_buy'&&wanted.has(o.buy)).map(o=>({op:o.op_id,household:household.id,user:session.user.id,buy:o.buy}));
}
// A sync that STARTS now: a sync already running may have begun before this purchase was queued, or
// before the server reverted it, so its result cannot be used (Work: overlapping shared undos).
async function freshSync(){if(syncing){try{await syncing}catch(_){}}return syncNow()}
async function undoPurchases(ticket){
 if(!ticket?.length||ticket.some(x=>x.household!==household?.id||x.user!==session?.user?.id))throw Error('共有する家族が変わったため、この操作は戻せません。');
 await freshSync();
 if(status.state!=='synced')throw Error('通信できません。つながってから「元に戻す」を押してください。');
 // v51: with purchaseUndoWindowV51 (default off) the server also checks the 10-minute window
 // (hh_undo_purchases_v51, synthetic trial households only); elsewhere the existing RPC is used.
 try{
  const ops={p_ops:ticket.map(x=>x.op)};
  if(cfg.purchaseUndoWindowV51===true){
   // Work 9th: not confirmed by a receipt (offline, not yet sent, or refused): not offered, nothing is sent.
   if(!undoConfirmed(ticket))throw Object.assign(Error('purchase_undo_unprovable'),{code:'unconfirmed'});
   // Work 6th: only the exact answer {status:'not_enabled'} (a household outside the trial) may use the
   // existing RPC. null, a missing status, any other answer or an error never falls back to it.
   const r=await rpc('hh_undo_purchases_v51',ops);
   const keys=r&&typeof r==='object'&&!Array.isArray(r)?Object.keys(r):[];
   if(keys.length===1&&r.status==='not_enabled')await rpc('hh_undo_purchases',ops);
   else if(!(r?.status==='ready'&&Number.isInteger(r.undone)&&r.undone>=0))throw Object.assign(Error('undo_answer_unknown'),{code:'unknown_answer'});
   // Work 9th: the server's own rows of THIS undo are shown at once (by change number; a later pull agrees),
   // whatever the overall sync is doing (another undo in flight, a failed pull).
   else if(Array.isArray(r.records)&&engine){try{engine.adoptRecords(r.records)}catch(e){root.console?.warn?.('あとこれ 取り消し結果の反映',e)}}
  }else await rpc('hh_undo_purchases',ops);
 }
 catch(e){const m=e.message||'';throw Error(e.code==='network'?'通信を確認できませんでした。「元に戻す」を押し直してください。':/purchase_undo_expired/.test(m)?'「買った」から10分を過ぎたため、取り消せません。ストックの数量を直接直してください。':/purchase_undo_unprovable|purchase_undo_time_invalid/.test(m)?'この「買った」はサーバーが受け付けた記録がないため（通信できない間の記録など）、家族共有では取り消せません。ストックの数量を直接直してください。':e.code==='unknown_answer'?'取り消しの結果を確認できませんでした。現在のストックをご確認ください（再度押しても二重には取り消しません）。':'家族の変更と重なるため戻せません。現在のストックをご確認ください。')}
 // Work 8th (WebKit): the server confirmed THIS purchase's undo above (or answered that it was already
 // undone); that is the result. The overall sync state at this moment (another purchase's undo in flight,
 // one failed pull) only decides when the screen shows it, never whether this undo succeeded.
 try{await freshSync()}catch(e){root.console?.warn?.('あとこれ 取り消し後の同期',e)}
 if(status.state!=='synced'){pollAfter('active');setTimeout(()=>{void syncNow()},1500)}
}
function photoScope(id){
 if(!engine||!household||!session)return null;
 engine.flush();const sid=engine.meta().map['item:'+id];
 return sid?{household:household.id,user:session.user.id,sid}:null;
}
function sameScope(a,b){return a&&b&&a.household===b.household&&a.user===b.user&&a.sid===b.sid}
function photoSharingEnabled(){return cfg.photoGatewayEnabled===true}
function photoProtocolManaged(){return cfg.photoGatewayProtocol===2}
function photoGeneralEnabled(){return photoSharingEnabled()&&photoProtocolManaged()}
function validPhotoPath(path,scope){return typeof path==='string'&&!/\s/.test(path)&&scope&&path.startsWith(scope.household+'/'+scope.sid+'/')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]{8,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(path)}
async function photoRequest(path,method='GET',blob){
 if(!photoSharingEnabled())throw Error('写真の家族共有は現在停止中です。端末内の写真は残っています。');
 if(!session)throw Error('家族共有に参加してからお試しください。');
 if(session.expires_at-60<Date.now()/1000)await refreshSession();
 const controller=new root.AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{
  // Only the protected gateway is permitted. No direct Storage fallback.
  {
   const op=method==='GET'?'read':method==='POST'?'write':null;
   if(!op)throw Error('写真の共有操作を確認できませんでした。');
   if(typeof path!=='string')throw Error('写真の保存先を確認できませんでした。');
   const parts=path.split('/');
   if(!validPhotoPath(path,{household:parts[0],sid:parts[1]}))throw Error('写真の保存先を確認できませんでした。');
   const payload=op==='read'?{operation:'read',path}:{operation:'write',householdId:parts[0],recordId:parts[1]};
   if(op==='write'){
    if(!blob||blob.size===0||blob.size>81920||blob.type!=='image/jpeg')throw Error('写真サイズ・形式を確認してください。');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';
    for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
    payload.base64=root.btoa(binary);
   }
   const response=await root.fetch(base+'/functions/v1/atokore-photo-gateway',{
    method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify(payload),cache:'no-store',signal:controller.signal
   });
   if(!response.ok)throw Error('写真の共有許可を確認できませんでした。');
   if(op==='read')return response.blob();
   const data=await response.json();
   if(!validPhotoPath(data?.path,{household:parts[0],sid:parts[1]}))throw Error('写真の保存先を確認できませんでした。');
   return data.path;
  }

 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('通信できません。端末に保存済みの写真は残っています。つながってからお試しください。');throw e}finally{clearTimeout(timeout)}
}
// Candidate general protocol (disabled in trial config). Journal is persisted
// by product-photos in its existing IndexedDB record BEFORE network transfer.
function photoUuid(x){return typeof x==='string'&&x.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x)}
function photoRevision(x){return Number.isSafeInteger(x)&&x>=0}
// An earlier sync may already have finished its push/pull before the photo
// operation committed. Wait for that flight, then start a fresh observation.
async function syncPhotoFresh(){const active=syncing;if(active)await active;return syncNow()}
function photoBase(scope){const row=engine?.meta()?.base?.['item:'+scope.sid];return row&&!row.deleted&&photoRevision(row.seq)?row:null}
async function photoTransferPlan(id,blob,prior=null){
 if(!photoGeneralEnabled())throw Error('写真の家族共有は現在停止中です。');
 const scope=photoScope(id);if(!scope)throw Error('家族共有に参加してください。');
 if(blob&&(blob.type!=='image/jpeg'||blob.size<1||blob.size>81920))throw Error('写真の形式を確認してください。');
 const digest=blob?[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join(''):null;
 await syncPhotoFresh();
 if(status.state!=='synced'||!sameScope(scope,photoScope(id))||engine.status().pending)throw Error('共有先を確認できませんでした。端末内の写真は残っています。');
 const row=photoBase(scope);if(!row)throw Error('最新の商品情報を確認できませんでした。');
 const operation=blob?'write':'delete';
 if(prior){
  if(prior.v!==2||!sameScope(prior.scope,scope)||prior.operation!==operation||prior.digest!==digest||
   !photoUuid(prior.operationId)||!photoRevision(prior.expectedSeq)||
   (prior.expectedPath!==null&&!validPhotoPath(prior.expectedPath,scope)))
   throw Error('前回の写真共有を確認できません。端末内の写真は残っています。');
  return prior; // never silently refresh a pending operation's original revision
 }
 const expectedPath=row.fields?.photoPath??null;
 if(expectedPath!==null&&!validPhotoPath(expectedPath,scope))throw Error('以前の写真の移行が必要です。');
 return {v:2,scope,operation,digest,operationId:root.crypto.randomUUID(),expectedPath,expectedSeq:row.seq};
}
async function generalPhotoPost(id,scope,payload){
 if(!photoGeneralEnabled()||!session||!sameScope(scope,photoScope(id)))throw Error('写真の共有先が変わりました。');
 if(session.expires_at-60<Date.now()/1000)await refreshSession();
 if(!sameScope(scope,photoScope(id)))throw Error('写真の共有先が変わりました。');
 const token=session.access_token,controller=new root.AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const res=await root.fetch(base+'/functions/v1/atokore-photo-general-v50',{method:'POST',headers:{
   apikey:cfg.anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'
  },body:JSON.stringify(payload),cache:'no-store',signal:controller.signal});
  if(!sameScope(scope,photoScope(id)))throw Error('写真の共有先が変わりました。');
  if(!res.ok){
   let reason=null;try{reason=(await res.clone().json())?.error??null}catch(_){}
   if(res.status===409&&reason==='photo_limit')throw Object.assign(Error('家族で共有できる写真の上限に達しました。端末内の写真は残っています。共有中の写真を差し替えるか外すと、新しい写真を共有できます。'),{code:'photo_limit'});
   throw Error(res.status===409?'写真の変更が競合しました。端末内の写真は残っています。':'写真を共有できませんでした。端末内の写真は残っています。');
  }
  return payload.operation==='read'?await res.blob():await res.json();
 }finally{clearTimeout(timeout)}
}
async function shareGeneralPhoto(id,blob,prior){
 if(!prior)throw Error('写真の操作記録が保存されていません。');
 const plan=await photoTransferPlan(id,blob,prior),scope=plan.scope;
 let path=null;
 if(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
  const data=await generalPhotoPost(id,scope,{operation:'write',householdId:scope.household,recordId:scope.sid,
   operationId:plan.operationId,expectedPath:plan.expectedPath,expectedSeq:plan.expectedSeq,base64:root.btoa(binary)});
  if(!validPhotoPath(data?.path,scope)||!photoRevision(data.seq))throw Error('写真の保存先を確認できませんでした。');
  path=data.path;
 }else{
  const current=photoBase(scope)?.fields?.photoPath??null;
  // Lost detach reply: if the intended state is already absent, no new delete.
  if(current!==null){
   if(current!==plan.expectedPath)throw Error('家族が写真を変更しました。');
   const data=await generalPhotoPost(id,scope,{operation:'delete',path:plan.expectedPath,expectedSeq:plan.expectedSeq});
   if(data?.deleted!==true||!photoRevision(data.seq))throw Error('写真の解除を確認できませんでした。');
  }
 }
 // The server owns the reference. Never write a local photoPath or hh_push it.
 await syncPhotoFresh();
 return {shared:status.state==='synced'&&sameScope(scope,photoScope(id))&&
  !!photoBase(scope)&&(photoBase(scope).fields?.photoPath??null)===path};
}

async function fetchPhoto(id,path){
 if(!photoSharingEnabled())return null;
 const scope=photoScope(id);if(!validPhotoPath(path,scope))return null;
 const blob=photoGeneralEnabled()?await generalPhotoPost(id,scope,{operation:'read',path}):await photoRequest(path);
 if(!sameScope(scope,photoScope(id)))return null;
 if(blob.type!=='image/jpeg'||blob.size>81920||blob.size===0)throw Error('写真の形式を確認できませんでした。');
 return blob;
}
// resume: {sentPath, uploaded(path)} from the device photo record. The gateway names each upload
// itself, so a retry after an unconfirmed attempt must NOT upload again: a second upload gets a new
// path, the family then reads a reference that is no longer current, and the first file is orphaned.
async function sharePhoto(id,blob,transfer=null,resume=null){
 if(photoGeneralEnabled())return shareGeneralPhoto(id,blob,transfer);
 if(!photoSharingEnabled())throw Error('写真の家族共有は現在停止中です。端末内の写真は残っています。');
 const scope=photoScope(id);if(!scope)throw Error('家族共有に参加してからお試しください。');
 if(blob&&(blob.type!=='image/jpeg'||blob.size>81920||blob.size===0))throw Error('写真の形式を確認できませんでした。');
 await syncPhotoFresh();if(status.state!=='synced'||engine.status().pending)throw Error('端末には保存済みです。写真の共有は通信が戻ってからお試しください。');
 const current=readState()?.items.find(x=>String(x.id)===String(id));if(!current||!sameScope(scope,photoScope(id)))throw Error('共有先が変わりました。商品を開き直してください。');
 // The earlier attempt for these same bytes already uploaded and recorded its path: only confirm.
 const resumed=!!blob&&typeof resume?.sentPath==='string'&&validPhotoPath(resume.sentPath,scope)&&current.photoPath===resume.sentPath;
 let path=blob?scope.household+'/'+scope.sid+'/'+root.crypto.randomUUID()+'.jpg':null;
 if(resumed)path=resume.sentPath;
 else{
  const expected=JSON.stringify([current.name,current.unit,current.photoPath]);
  if(blob){
   path=await photoRequest(path,'POST',blob);
   // Remember the uploaded path with the device photo before anything else can fail.
   if(typeof resume?.uploaded==='function')await resume.uploaded(path);
  }
  const next=readState(),item=next?.items.find(x=>String(x.id)===String(id));
  if(!item||!sameScope(scope,photoScope(id))||JSON.stringify([item.name,item.unit,item.photoPath])!==expected)throw Error('共有先か商品が変わりました。写真の共有は反映していません。');
  item.photoPath=path;
  if(!writeState(next))throw Error('端末の空き容量を確認してください。写真の共有情報を保存できませんでした。');
 }
 engine.flush();await syncPhotoFresh();
 const confirmed=photoBase(scope);
 return {shared:status.state==='synced'&&sameScope(scope,photoScope(id))&&
   engine.status().pending===0&&!!confirmed&&(confirmed.fields?.photoPath??null)===path&&
   (readState()?.items.find(x=>String(x.id)===String(id))?.photoPath??null)===path};
}
// ---------------------------------------------------------------- v51 shopping assignments (draft RPCs)
// Enabled only when the server has the reviewed SQL (cfg.buyAssignments===true). The server checks
// membership and the expected revision; a stale view is refused and the latest state is fetched.
let assignments=new Map(),assignmentsAt=0,sharedEpoch=0;
// ---------------------------------------------------------------- v51 undo rights (Work 8th)
// A shared purchase can be undone only if the server accepted it through the dedicated purchase command
// (hh_push_v51, trial households with the reviewed SQL; probed like the earlier ticket). The server then
// writes a receipt and the window is 10 minutes from that moment. A purchase made offline, sent later by
// the ordinary sync, or by an older app gets no receipt (cannot be undone in sharing; stock can be
// corrected directly). The earlier clock tickets proved nothing and are gone.
let receiptSupported=null;
function receiptsOn(){return !!household&&!!session&&receiptSupported!==false}
// Probe once per household (a read-only status call; the command itself refuses an empty input).
async function refreshReceiptSupport(force){
 if(!household||!session)return;
 if(!force&&receiptSupported!==null)return;
 const ep=sharedEpoch,hid=household.id;
 try{
  const r=await rpc('hh_purchase_receipts_status_v51',{});
  if(ep!==sharedEpoch||household?.id!==hid)return;
  const keys=r&&typeof r==='object'&&!Array.isArray(r)?Object.keys(r):[];
  receiptSupported=keys.length===1&&r.status==='not_enabled'?false:r?.status==='ready'?true:receiptSupported;
 }catch(e){if(e.status===404||/hh_push_v51|PGRST202|function/i.test(e.message||''))receiptSupported=false}
}
// Where the server holds receipts it also removes the purchase's estimate entries in the undo transaction.
function serverUndoEstimate(){return receiptsOn()&&receiptSupported===true}
function assignmentsEnabled(){return cfg.buyAssignments===true&&!!household&&!!session}
async function refreshAssignments(){
 if(!assignmentsEnabled())return;
 // An answer that arrives after leaving (or after switching household) belongs to the old household.
 const ep=sharedEpoch,hid=household?.id;
 try{const rows=await rpc('hh_buy_assignments',{});if(ep!==sharedEpoch||household?.id!==hid||!Array.isArray(rows))return;
  assignments=new Map(rows.filter(r=>r&&typeof r.buy_id==='string').map(r=>[r.buy_id,{assignee:r.assignee||null,requester:r.requester||null,response:r.response||'none',rev:Number(r.rev)||0}]));
  assignmentsAt=Date.now();doc.dispatchEvent(new CustomEvent('atokore-assignments-updated'));
 }catch(e){root.console?.warn?.('あとこれ 担当の取得',e)}
}
function buySid(localId){engine?.flush?.();return engine?.meta?.().map?.['buy:'+localId]||null}
function assignmentFor(localId){const sid=buySid(localId);return sid?{sid,...(assignments.get(sid)||{assignee:null,requester:null,response:'none',rev:0})}:null}
// The household plan as the server reports it (hh_entitlements), read at most every 10 minutes and
// only when a screen asks (the photo counter). Unknown stays null: the screen says "確認中".
let entCache=null,entAt=0;
function entitlements(){return household&&session?entCache:null}
async function refreshEntitlements(){
 if(!household||!session)return null;
 if(entCache&&Date.now()-entAt<600000)return entCache;
 const ep=sharedEpoch,hid=household.id;
 try{const r=await rpc('hh_entitlements',{});if(ep===sharedEpoch&&household?.id===hid){entCache=r;entAt=Date.now()}}catch(e){console.error('あとこれ: プランの確認',e?.code||e?.message)}
 return entCache;
}
function familyMembers(){return (Array.isArray(meta.members)?meta.members:[]).filter(m=>m&&typeof m.id==='string').map(m=>({id:m.id,name:m.name,me:m.me}))}
async function assignBuy(localId,assigneeId){
 if(!assignmentsEnabled())throw Error('担当の機能は現在使えません。');
 const a=assignmentFor(localId);if(!a)throw Error('この買い物はまだ家族に届いていません。同期してからお試しください。');
 const r=await rpc('hh_buy_assign',{p_buy:a.sid,p_assignee:assigneeId,p_expected_rev:a.rev});
 if(r?.status==='stale'){await refreshAssignments();return {status:'stale'}}
 if(r?.status==='ready'||r?.status==='unchanged')await refreshAssignments();
 return {status:r?.status||'error'};
}
async function respondBuy(localId,decision){
 if(!assignmentsEnabled())throw Error('担当の機能は現在使えません。');
 const a=assignmentFor(localId);if(!a)throw Error('この買い物はまだ家族に届いていません。');
 const r=await rpc('hh_buy_respond',{p_buy:a.sid,p_decision:decision,p_expected_rev:a.rev});
 await refreshAssignments();
 return {status:r?.status||'error'};
}
// ---------------------------------------------------------------- v51 shared preparation (draft RPCs)
function prepEnabled(){return cfg.prepSharing===true&&!!household&&!!session}
async function prepGet(day){if(!prepEnabled())return null;return rpc('hh_prep_get',{p_day:day})}
async function prepPut(doc,rev){if(!prepEnabled())throw Error('共有の設定が使えません。');return rpc('hh_prep_put',{p_doc:doc,p_expected_rev:rev})}
async function prepTick(day,instance,done){if(!prepEnabled())throw Error('共有の設定が使えません。');return rpc('hh_prep_tick',{p_day:day,p_instance:instance,p_done:done})}
async function refreshChanges(){
 const target=household&&session?household.id+':'+session.user.id:null;
 if(!target)return;
 if(changesRequest?.target===target)return changesRequest.promise;
 if(changesFor!==target){changes=[];changesFor=target;historyState='loading';paint()}
 const controller=new root.AbortController(),guard={target,controller,promise:null};
 const timeout=setTimeout(()=>controller.abort(),8000);
 const task=Promise.resolve().then(async()=>{
  try{
   const rows=await rpc('hh_changes',{p_limit:50},controller.signal);
   if(changesRequest!==guard||(household&&session?household.id+':'+session.user.id:null)!==target)return;
   if(!Array.isArray(rows))throw Error('invalid_history');
   changes=rows;historyState='ready';
  }catch(e){
   if(changesRequest!==guard||(household&&session?household.id+':'+session.user.id:null)!==target)return;
   historyState='error';
  }finally{clearTimeout(timeout);if(changesRequest===guard)changesRequest=null;paint()}
 });
 guard.promise=task;changesRequest=guard;return task;
}
const saveMeta=patch=>{const next={...meta,...patch};if(!writeJSON(META_KEY,next))return false;meta=next;return true};

// ---------------------------------------------------------------- network (Supabase Auth + PostgREST RPC)
class NetError extends Error{constructor(m,code,status){super(m);this.code=code;this.status=status}}
// Every request ends within a time limit, also while reading the answer (v51: a connection that never
// settled kept the sync guard forever, so later syncs returned the same stuck promise — the "Chromium
// sync stops now and then" case). A timed-out push is safe to send again: hh_push is idempotent by op_id.
let requestTimeouts=0;
async function request(path,body,auth,signal){
 const controller=new root.AbortController();
 const limit=Number(cfg.requestTimeoutMs)>0?Number(cfg.requestTimeoutMs):20000;
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},limit);
 const follow=()=>controller.abort();
 if(signal){if(signal.aborted)controller.abort();else signal.addEventListener?.('abort',follow,{once:true})}
 try{
  let res;
  try{res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.anonKey,...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body||{}),signal:controller.signal})}
  catch(e){if(timedOut)requestTimeouts++;throw new NetError('offline','network',0)}
  let text;
  try{text=await res.text()}catch(e){if(timedOut)requestTimeouts++;throw new NetError('offline','network',0)}
  let data=null;try{data=text?JSON.parse(text):null}catch(e){}
  if(!res.ok)throw new NetError(data?.message||data?.msg||data?.error_description||('HTTP '+res.status),data?.code||'http',res.status);
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',follow)}
}
function keepSession(s){
 if(!s?.access_token||!s?.refresh_token||!s?.user?.id)throw new NetError('bad_session','auth',0);
 const next={access_token:s.access_token,refresh_token:s.refresh_token,expires_at:Number(s.expires_at)||Math.floor(Date.now()/1000)+Number(s.expires_in||3600),user:{id:s.user.id,email:s.user.email||'',is_anonymous:s.user.is_anonymous===true}};
 if(!writeJSON(SESSION_KEY,next))throw new NetError('ログイン情報を端末に保存できませんでした','storage',0);
 session=next;
}
async function refreshSession(){
 if(!session?.refresh_token)throw new NetError('signed_out','auth',401);
 keepSession(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token}));
}
async function rpc(fn,args,signal){
 if(!session)throw new NetError('signed_out','auth',401);
 if(session.expires_at-60<Date.now()/1000)await refreshSession();
 try{return await request('/rest/v1/rpc/'+fn,args,session.access_token,signal)}
 catch(e){if(e.status===401){await refreshSession();return request('/rest/v1/rpc/'+fn,args,session.access_token,signal)}throw e}
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
 engine=core.createEngine({readState,writeState,opIdFor,receipts:()=>receiptsOn()&&receiptSupported===true&&root.navigator?.onLine!==false,readMeta:()=>{const m=readJSON(META_KEY);if(m&&typeof m==='object')meta=m;return meta.engine||null},writeMeta:m=>saveMeta({engine:m}),rpc,device:meta.device,managedPhotos:cfg.photoGatewayProtocol===2});
 return engine;
}
function setStatus(state,detail){status={state,detail,pending:engine?engine.status().pending:0};paint()}
// opts.poll: a periodic background poll. Only those skip history/member reads when nothing changed;
// an explicit sync (button, API, coming back, online) always refreshes them as before.
async function syncNow(opts){
 const poll=opts?.poll===true;
 if(!engine||!household)return status;
 if(syncing)return syncing;
 // Defer execution until the guard is assigned. An offline failure can happen before the
 // first await; an immediately invoked async function would clear then overwrite the guard.
 syncing=Promise.resolve().then(async()=>{
  try{
   if(root.navigator&&root.navigator.onLine===false)throw new NetError('offline','network',0);
   setStatus('syncing');
   const before=engine.status();
   await engine.sync();
   const s=engine.status();
   setStatus(s.pending?'pending':'synced');
   // v51 traffic: history and members are fetched again only when something changed (the
   // server cursor moved or this device sent changes) or they were never loaded; a quiet poll
   // costs one hh_pull instead of three requests.
   const changed=s.cursor!==before.cursor||before.pending>s.pending;
   if(!poll||changed||historyState!=='ready')await refreshChanges();
   if(!s.pending){await refreshMembers(changed||!poll);paint()}
   if(assignmentsEnabled()&&(changed||!poll||!assignmentsAt))await refreshAssignments();
   if(!poll||root.document?.visibilityState!=='hidden')await refreshReceiptSupport(false);
   pollAfter(changed?'active':'quiet');
  }catch(e){
   if(e.code==='rejected'||e.code==='recovery')setStatus('blocked');
   else if(e.code==='storage')setStatus('storage');
   else if(e.code==='network')setStatus('offline');
   else if(e.code==='auth'||e.status===401)setStatus('auth');
   else if(/not_member/.test(e.message)){household=null;forgetShared();saveMeta({household:null});setStatus('removed')}
   else setStatus('error',e.message);
   if(e.code==='network'||!['rejected','recovery','storage','auth'].includes(e.code))pollAfter('failed');
   if(household&&session){const current=household.id+':'+session.user.id;if(changesFor!==current)changes=[];changesFor=current;historyState='error';paint()}
   root.console?.warn?.('あとこれ 家族共有の同期',e);
  }
  return status;
 }).finally(()=>{syncing=null});
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
   clearTimeout(pending);pending=setTimeout(syncNow,1500);pollAfter('active');
  }
 },1000);
 pollAfter('active');
}
// v51 traffic: adaptive polling instead of a fixed 20 s pull. Active (a change went either way):
// 20 s. Quiet: grows ×1.5 up to 2 min. After a failed request: doubles up to 5 min (backoff). A
// hidden page never polls; coming back, going online or a local edit syncs at once and resets.
const POLL_MIN=20000,POLL_QUIET_MAX=120000,POLL_FAIL_MAX=300000,MEMBERS_TTL=300000;
let pollDelay=POLL_MIN;
function pollAfter(kind){
 pollDelay=kind==='active'?POLL_MIN:kind==='failed'?Math.min(POLL_FAIL_MAX,Math.max(POLL_MIN,pollDelay*2)):Math.min(POLL_QUIET_MAX,Math.round(pollDelay*1.5));
 clearTimeout(puller);
 if(!engine||!household)return;
 puller=setTimeout(()=>{if(doc.visibilityState!=='hidden')syncNow({poll:true});else pollAfter('quiet')},pollDelay);
}
root.addEventListener?.('online',()=>{pollAfter('active');syncNow()});
doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible'){pollAfter('active');syncNow()}});
// Another tab of this app wrote the data or the sync record (Work 7th): adopt it here, so this tab never
// saves its older copy over it or diffs against an older shadow (which re-sent that tab's change).
root.addEventListener?.('storage',e=>{
 try{
  if(e.key===META_KEY){const m=readJSON(META_KEY);if(m&&typeof m==='object')meta=m;return}
  // Work 8th: the data itself is adopted (and merged with anything unsaved here) by data-safety; this only
  // notes that the change was another tab's, so this tab does not send it again.
  if(e.key!==DATA_KEY||e.newValue==null||e.newValue===lastRaw)return;
  lastRaw=e.newValue;
 }catch(err){root.console?.warn?.('あとこれ 別のタブの変更',err)}
});
// A fresh clock ticket before the next purchase (Work 7th), e.g. when the shopping page opens.
doc.addEventListener('atokore-page-changed',()=>{void refreshReceiptSupport(false)});

// ---------------------------------------------------------------- UI helpers (DOM + textContent only)
function el(tag,props,children){
 const n=doc.createElement(tag);
 for(const [k,v] of Object.entries(props||{})){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v)}
 for(const c of children||[])if(c)n.append(c);
 return n;
}
const STATUS_TEXT={local:'共有していません',syncing:'同期しています…',synced:'家族と共有済み',pending:'送信待ちがあります',offline:'オフライン：この端末に保存済み。つながったら送ります',auth:'ログインし直してください',error:'送信に失敗しました。自動でやり直します',removed:'この世帯から外れました（端末の在庫は残っています）'};
STATUS_TEXT.blocked='共有できない変更があります。端末のデータを残して同期を止めています';
STATUS_TEXT.storage='変更を端末に保存できませんでした。在庫は残っています。空き容量とブラウザの保存設定を確認してください';
function paint(){
 const sum=shareSummary();
 const chip=$('atkHouseholdChip');
 if(chip){chip.hidden=!household;chip.textContent=household?sum.headline:'';chip.dataset.state=sum.kind}
 const meta2=$('atkHouseholdCardMeta');if(meta2)meta2.textContent=household?sum.headline:'招待した家族と在庫・買い物リストを共有（限定テスト）';
 const line=$('atkHouseholdStatus');if(line)line.textContent=sum.headline;
 const detail=$('atkHouseholdDetail');if(detail){detail.textContent=sum.detail;detail.hidden=!sum.detail}
 const act=$('atkHouseholdSyncNow');if(act){act.textContent=sum.kind==='unknown'||sum.kind==='checking'?'再確認する':'今すぐ同期';act.classList.toggle('atk-hh-primary-action',sum.kind!=='shared')}
 doc.dispatchEvent(new root.CustomEvent('atokore-household-updated'));
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
const friendly=e=>e?.code==='anonymous_provider_disabled'?'Googleなしの参加は準備中です。Googleで参加するか、設定完了後にお試しください':ERR[e?.message]||ERR[e]||('うまくいきませんでした（'+(e?.message||e)+'）');
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
function downloadRecovery(saved=false){
 const b=saved===true?readJSON(RECOVERY):{at:Date.now(),data:readState(),engine:engine?.meta()};
 if(!b?.data)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify({app:'atokore',format:1,exportedAt:new Date(b.at).toISOString(),data:b.data},null,1)],{type:'application/json'}));
 const a=el('a',{href:url,download:'atokore-sync-recovery.json'});doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
const counts=s=>'在庫'+(s?.items?.length||0)+'件・買い物'+(s?.buys?.length||0)+'件・いつものリスト'+(s?.routines?.length||0)+'件';

function recoveryHelp(){
 sheet('機種変更・データの復旧',[
  el('h3',{text:'Googleで参加した方'}),
  note('新しい端末で同じ試用版を開き、マイページ → 家族共有 → 同じGoogleアカウントでログインします。「共有のデータを使う」を選び、内容を確認してください。新しい世帯を作る必要はありません。'),
  note('復旧できるのは、共有先へ送信済みの在庫・買い物リスト・いつものリスト'+(photoSharingEnabled()?'・写真':'（写真は現在対象外）')+'です。Googleログインだけではバックアップになりません。家族共有を開始し、旧端末で「未送信あり」が出ていないことを確認してください。'),
  note('未送信の変更（写真を含む）・端末内だけの控え・表示設定は、Googleログインだけでは戻りません。Googleは本人確認に使い、共有データはあとこれ側に保存します。'),
  el('h3',{text:'Googleなしで参加した方'}),
  note('同じ端末・同じブラウザなら次回も自動接続します。機種変更、ブラウザのデータ削除、ログアウト後は同じ参加者として戻れません。作成者の家族共有画面で以前の参加者を「外して再招待」し、新しい招待リンクから参加してください。'),
  note('再招待しても、共有済みの在庫'+(photoSharingEnabled()?'と写真':'（写真の共有は現在停止中）')+'は残ります。旧端末で未送信だった変更は戻りません。Safariとホーム画面アプリなど、保存領域が分かれる場合も再参加が必要です。'),
  button('家族共有へ戻る',()=>open(),'atk-hh-secondary')]);
}
function invitationURL(code){
 const u=new URL(root.location.href);u.search='';u.hash='invite='+code;return u.href;
}
function codeValue(value){return String(value||'').trim().toUpperCase().replace(/[\s-]/g,'')}
async function joinWithCode(name,value){
 const code=codeValue(value),display=String(name||'').trim();
 if(!display||display.length>20)throw '表示名を1〜20文字で入れてください';
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code))throw '招待コードを8文字で入力してください';
 rememberInvite(code);
 if(!session){
  if(cfg.guest!==true)throw 'Googleでログインしてから参加してください';
  // A session is created only by an explicit Join, never by opening an invitation.
  keepSession(await request('/auth/v1/signup',{}));
 }
 // A lost join response must not consume a second invitation or add stock twice.
 let my=await rpc('hh_my',{});
 if(my?.household){
  if(meta.pendingJoin?.user!==session.user.id||meta.pendingJoin?.code!==code)throw 'already_member';
 }else{
  if(!saveMeta({pendingJoin:{user:session.user.id,code}}))throw '参加準備を保存できませんでした';
  my=await rpc('hh_join',{p_code:code,p_display_name:display});
  if(my?.error){saveMeta({pendingJoin:null});throw my.error}
 }
 if(!my?.household?.id)throw '共有先を確認できませんでした';
 const next={id:my.household.id,name:my.household.name};
 if(!saveMeta({household:next,pendingJoin:null,...since(next)}))throw '参加情報を保存できませんでした。もう一度お試しください';
 household=next;rememberInvite('');makeEngine();engine.startAsJoiner();
 await choosePlacement(my);
}
function joinScreen(){
 if(household)return dashboard();
 const name=el('input',{id:'atkHhGuestName',type:'text',maxlength:'20',autocomplete:'nickname',placeholder:'例：パパ'});
 const code=el('input',{id:'atkHhGuestCode',type:'text',maxlength:'12',autocapitalize:'characters',autocomplete:'off',placeholder:'8文字',value:inviteCode});
 const canJoin=!!session||cfg.guest===true;
 sheet('招待コードで家族に参加',[
  note('名前と招待コードを入れて参加します。コードは発行から24時間・1回だけ使えます。開いただけでは共有されません。参加すると在庫'+(photoSharingEnabled()?'と商品写真が共有されます。相手が保存した写真のコピーは後から回収できません。':'が共有されます。写真は現在共有されません。')),
  field('家族に表示される名前',name),field('家族から届いた招待コード',code),
  canJoin?button(session?'共有に参加する':'Googleなしで共有に参加する',e=>busy(e.target,()=>joinWithCode(name.value,code.value))):note('この試用版では、Googleでログインしてから参加します。'),
  !session&&googleAuth?button('Googleで参加する（機種変更時に復旧しやすい）',e=>busy(e.target,()=>{
   const c=codeValue(code.value);if(!/^[A-HJ-NP-Z2-9]{8}$/.test(c))throw '招待コードを8文字で入力してください';
   rememberInvite(c);return googleAuth.start();
  }),'atk-hh-secondary'):null,
  note('Googleなしの参加情報はこのブラウザに保存されます。機種変更・データ削除時は作成者から再招待してもらってください。アプリを開いたときや通信が戻ったときに自動同期します。'),
  button('機種変更・復旧の手順を見る',recoveryHelp,'atk-hh-link'),
  button('戻る',()=>open(),'atk-hh-link')]);
}

// ---------------------------------------------------------------- screens
async function open(){
 if(!session)return signIn();
 if(!household)return chooseHousehold();
 // Joined earlier but the choice about this device's data was never made: ask again before syncing.
 if(!meta.engine?.shadow&&!meta.engine?.pendingApply){
  try{makeEngine();engine.startAsJoiner();return await choosePlacement(await rpc('hh_my',{}))}catch(e){notice(friendly(e));return}
 }
 if(!engine)makeEngine();
 return dashboard();
}
function signIn(){
 const google=googleAuth?button('Googleでログイン',e=>busy(e.target,()=>googleAuth.start())):null;
 const email=el('input',{type:'email',autocomplete:'email',inputmode:'email',placeholder:'you@example.com',id:'atkHhEmail'});
 const code=el('input',{type:'text',inputmode:'numeric',autocomplete:'one-time-code',maxlength:'6',placeholder:'6桁',id:'atkHhCode'});
 const step2=el('div',{class:'atk-hh-step',hidden:''},[field('メールに届いた6桁のコード',code),button('ログイン',e=>busy(e.target,async()=>{
  if(!/^\d{6}$/.test(code.value.trim()))throw 'コードは6桁の数字です';
  keepSession(await request('/auth/v1/verify',{type:'email',email:email.value.trim(),token:code.value.trim()}));
  await afterSignIn();
 }))]);
 sheet('家族共有（限定テスト）',[
  note((cfg.guest===true?'作成者はGoogleでログイン。招待された方はGoogleなしでも参加できます。':'家族それぞれが自分の'+(googleAuth?'Googleアカウント':'メールアドレス')+'でログインします。')+'同じ在庫・買い物リスト・いつものリストを使えます。無料で1世帯2人まで。'+(photoSharingEnabled()?'商品の写真も家族と自動で共有されます。':'写真の家族共有は現在停止中です。')),
  button('招待コードを入力して参加する',joinScreen),
  google,
  note('作成者はGoogleでログインして世帯を作ります。Googleで参加した方は、端末変更後も同じアカウントから共有済みデータを引き継げます。'),
  button('機種変更・復旧の手順を見る',recoveryHelp,'atk-hh-link'),
  cfg.email===false?null:field('メールアドレス',email),
  cfg.email===false?null:button('確認コードを送る',e=>busy(e.target,async()=>{
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))throw 'メールアドレスを確認してください';
   await request('/auth/v1/otp',{email:email.value.trim(),create_user:true});
   step2.hidden=false;code.focus();notice('確認コードを送りました。メールを確認してください');
  })),step2]);
}
async function afterSignIn(){
 const my=await rpc('hh_my',{});
 if(my?.household){
  if(meta.household?.id===my.household.id&&(meta.engine?.shadow||meta.engine?.pendingApply)){makeEngine();watch();await syncNow();return dashboard()}
  // Same account on a new or reset device: receive the household, choosing what happens to local data.
  household={id:my.household.id,name:my.household.name};saveMeta({household,...since(household)});
  makeEngine();engine.startAsJoiner();
  return choosePlacement(my);
 }
 if(inviteCode)return joinScreen();
 chooseHousehold();
}
function chooseHousehold(){
 if(session?.user?.is_anonymous)return joinScreen();
 const name=el('input',{type:'text',maxlength:'20',placeholder:'例：ママ',id:'atkHhName'});
 const code=el('input',{type:'text',maxlength:'12',autocapitalize:'characters',placeholder:'8文字',id:'atkHhJoinCode',value:inviteCode});
 const local=readState();
 sheet('家族共有（限定テスト）',[
  field('家族に表示される名前',name),
  el('div',{class:'atk-hh-card'},[el('h3',{text:'世帯を作って家族を招待する'}),
   note('この端末の'+counts(local)+(photoSharingEnabled()?'と登録済みの商品写真が共有の最初のデータになります。相手が保存した写真のコピーは後から回収できません。':'が共有の最初のデータになります。写真は端末内に残ります。')+'共有前に端末内に控えを保存します。'),
   button('世帯を作る',e=>busy(e.target,async()=>{
    if(!name.value.trim())throw '名前を入れてください';
    if(!await ask('この端末のデータで共有を始めますか？','この端末の'+counts(local)+(photoSharingEnabled()?'と登録済みの写真を共有します。相手に保存された写真は後から回収できません。':'を共有します。写真の家族共有は現在停止中です。'),'共有を始める'))return;
    if(!backupDevice())throw '控えを保存できなかったため中止しました（何も変更していません）';
    const my=await rpc('hh_create',{p_name:'わが家',p_display_name:name.value.trim()});
    household={id:my.household.id,name:my.household.name};saveMeta({household,...since(household)});rememberMembers(my);
    makeEngine();engine.startAsCreator();watch();await syncNow();dashboard();
   }))]),
  el('div',{class:'atk-hh-card'},[el('h3',{text:'招待コードで参加する'}),field('家族から届いた招待コード',code),
   button('参加する',e=>busy(e.target,async()=>{
    await joinWithCode(name.value,code.value);
   }),'atk-hh-secondary')]),
  button('機種変更・復旧の手順を見る',recoveryHelp,'atk-hh-link'),
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
   if(!await ask('共有のデータに切り替えますか？','この端末の在庫などは共有のデータに置き換わります。控えは「共有前の控えをファイルに保存」で取り出せます。','切り替える'))return;
   if(!backupDevice())throw '控えを保存できなかったため中止しました（何も変更していません）';
   await engine.adopt({useShared:true});watch();await syncNow();dashboard();notice('共有のデータに切り替えました');
  })),
  button('この端末の商品も共有に加える（1件ずつ選ぶ）',()=>{list.hidden=false},'atk-hh-secondary'),
  note('同じ名前・単位・カテゴリの商品だけを「同じ商品」として表示します。サイズや容量が違う商品は別の商品のままです。'),
  list]);
}
async function dashboard(){
 const sum=shareSummary();
 const statusEl=el('div',{class:'atk-hh-summary',role:'status'},[
  el('p',{id:'atkHouseholdStatus',class:'atk-hh-status',text:sum.headline}),
  el('p',{id:'atkHouseholdDetail',class:'atk-hh-detail',text:sum.detail,...(sum.detail?{}:{hidden:''})}),
  button(sum.kind==='unknown'||sum.kind==='checking'?'再確認する':'今すぐ同期',e=>busy(e.target,async()=>{await syncNow();await refreshMembers(true);paint()}),'atk-hh-secondary')]);
 statusEl.lastChild.id='atkHouseholdSyncNow';
 const loadError=el('p',{class:'atk-hh-detail atk-hh-load-error',role:'alert',hidden:''});statusEl.append(loadError);
 const members=el('ul',{class:'atk-hh-members'});
 const inviteBox=el('div',{class:'atk-hh-invite'});
 const history=el('ol',{class:'atk-hh-history',hidden:''});
 const rejected=engine?.meta().rejected||[];
 const checkpoint=engine?.meta().pendingApply;
 const s=sheet((household?.name||'わが家')+'の家族共有',[
  statusEl,members,inviteBox,
  note(session?.user?.is_anonymous?'Googleなしで参加中。このブラウザに参加情報を保存しています。機種変更やデータ削除後は、作成者から再招待してもらってください。': 'ログイン中：'+(session?.user?.email||'登録済みアカウント')+'。機種変更後も同じアカウントでログインすると、共有先へ送信済みのデータを引き継げます。'),
  button('機種変更・復旧の手順を見る',recoveryHelp,'atk-hh-link'),
  button('変更履歴（だれが何を変えたか）',e=>busy(e.target,async()=>{
   const rows=await rpc('hh_changes',{p_limit:50});history.replaceChildren(...(Array.isArray(rows)?rows:[]).map(r=>el('li',{text:changeText(r)})));history.hidden=false;
  }),'atk-hh-secondary'),history,
  rejected.length||checkpoint?el('div',{class:'atk-hh-rejected'},[
   note(checkpoint?'前回の同期が端末への保存の途中で止まりました。端末の内容を残しています。まず「今すぐ同期」をお試しください。': '送れなかった変更が'+rejected.length+'件あります。端末の内容を残して同期を止めています。'),
   button('今の端末データをファイルに保存',downloadRecovery,'atk-hh-secondary'),
   button('控えを残して共有データに合わせる',e=>busy(e.target,async()=>{
    if(!await ask('共有の内容に合わせますか？','端末の内容を共有の内容に合わせます。今の端末データを控えとして残してから再開します。','合わせる'))return;
    const data=readState();
    if(!data||!writeJSON(RECOVERY,{at:Date.now(),data,engine:engine.meta()}))throw '控えを保存できなかったため中止しました';
    engine.resolveRejected();await syncNow();dashboard();
   }),'atk-hh-link')]):null,
  readJSON(RECOVERY)?button('同期を再開する前の控えをファイルに保存',()=>downloadRecovery(true),'atk-hh-link'):null,
  note((photoSharingEnabled()?'商品の写真は、共有開始前に登録した分も家族へ自動で共有されます。':'写真の家族共有は現在停止中です。')+'家族から外しても、相手がすでに見たり保存した写真・バックアップのコピーは回収できません。'),
  readJSON(BEFORE_SHARE)?button('共有前の控えをファイルに保存',downloadBackup,'atk-hh-link'):null,
  button('この世帯から抜ける（端末の在庫は残ります）',e=>busy(e.target,leave),'atk-hh-link'),
  button('ログアウト',()=>signOut(),'atk-hh-link')]);
 if(!s)return;
 try{
  const my=await rpc('hh_my',{});
  if(!my?.household){household=null;forgetShared();saveMeta({household:null});setStatus('removed');return chooseHousehold()}
  rememberMembers(my);paint();
  members.replaceChildren(...my.members.map(m=>el('li',{},[
   el('span',{text:m.display_name+(m.role==='owner'?'（作成者）':'')+(m.is_me?'・自分':'')}),
   my.me?.role==='owner'&&!m.is_me?button('外して再招待：'+m.display_name,e=>busy(e.target,async()=>{
    if(!await ask(m.display_name+'さんの参加情報を外しますか？',m.display_name+'さんの以前の参加情報を外します。以前の端末は今後共有できなくなります。共有済みの在庫は残ります。ただし相手がすでに見たり保存した写真・バックアップのコピーは消せません。その後、新しい招待コードを作ってください。続けますか？','外す'))return;
    await rpc('hh_remove_member',{p_user:m.user_id});await dashboard();
   }),'atk-hh-link'):null
  ])));
  const free=my.members.length<my.household.seat_limit;
  inviteBox.replaceChildren(free?button('家族を招待する（招待コードを作る）',e=>busy(e.target,async()=>{
   const inv=await rpc('hh_invite_create',{});
   const until=new Date(inv.expires_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   const link=invitationURL(inv.code);
   const linkInput=el('input',{id:'atkHhInviteLink',type:'text',readonly:'',value:link});
   inviteBox.replaceChildren(...[el('p',{class:'atk-hh-code',id:'atkHhInviteCode',text:inv.code}),note('リンクを開くと参加画面が表示されます。名前を入れて参加してください。'+until+'まで・1回だけ使えます。'),
    field('家族に送る招待リンク（長押しでコピーできます）',linkInput),
    root.navigator?.share?button('招待リンクを送る',()=>root.navigator.share({title:'あとこれの家族共有',text:'あとこれで在庫を共有しましょう。下のリンクをSafariなどで開き、名前を入れて参加してください。招待コード：'+inv.code+'（24時間・1回限り）',url:link}).catch(()=>{}),'atk-hh-secondary'):null,
    button('このコードを無効にする',e2=>busy(e2.target,async()=>{await rpc('hh_invite_revoke',{});inviteBox.replaceChildren(note('招待コードを無効にしました'))}),'atk-hh-link')].filter(Boolean));
  }),'atk-hh-secondary'):note('無料の家族共有は2人までです（同じ人の別の端末は人数に数えません）。'));
 }catch(e){loadError.textContent='参加者を読み込めませんでした：'+friendly(e);loadError.hidden=false}
}
// hh_changes returns who=null when no membership covers the time of the operation (the current server
// definition); older definitions always sent a name. Both read the same way here as on the home screen.
function changeText(r){
 const at=new Date(r?.at);
 const when=Number.isFinite(at.getTime())?at.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時不明';
 const delta=Number(r?.delta);
 const what=r?.type==='add'?(Number.isFinite(delta)?(delta>0?'＋':'')+delta:'数量を変更'):r?.type==='set'?(r.field==='name'?'名前':r.field||'商品情報')+'を変更':r?.type==='create'?'追加':r?.type==='delete'?'削除':r?.type==='complete_buy'?'「買った」でストックに追加':r?.type==='undo_purchase'?'「買った」を取り消し':'変更';
 const who=r?.who==null||String(r.who).trim()===''?'実行者不明':String(r.who);
 return when+' '+who+'：'+(r?.name||'（削除済み）')+' '+what;
}
async function leave(){
 if(engine)try{engine.flush()}catch(e){}
 const left=engine?engine.status().pending:0;
 if(left){try{await syncNow()}catch(e){}}
 const still=engine?engine.status().pending:0;
 if(!await ask('この世帯から抜けますか？',(still?'まだ家族に送れていない変更が'+still+'件あります。抜けると家族には届きません。':'')+'この端末の在庫はそのまま残ります。'+(assignmentsEnabled()?'\nあなたが頼まれていた買い物の担当は外れ、あなたが頼んで返事がまだのお願いは取り下げられます。届いていない通知も送られなくなります。':'')+(prepEnabled()?'\n持ち物の共有は止まり、今の内容はこの端末だけのものとして残ります。':''),'抜ける'))return;
 await rpc('hh_leave',{});
 stop();household=null;saveMeta({household:null,engine:null});setStatus('local');root.closeM?.();notice('世帯から抜けました。この端末の在庫はそのまま残っています');
}
// Leaving, being removed or signing out: nothing of the family's shared state stays usable here.
// sharedEpoch invalidates answers still in flight; the event tells the prep list to drop its household copy.
function forgetShared(){
 sharedEpoch++;assignments=new Map();assignmentsAt=0;entCache=null;entAt=0;receiptSupported=null;
 try{doc.dispatchEvent(new CustomEvent('atokore-household-left'));doc.dispatchEvent(new CustomEvent('atokore-assignments-updated'))}catch(e){root.console?.warn?.('あとこれ 共有の後片付け',e)}
}
function stop(){forgetShared();clearInterval(timer);clearTimeout(puller);timer=puller=null;engine=null;changesRequest?.controller.abort();changesRequest=null;changes=[];changesFor=null;historyState='loading'}
async function signOut(){
 const left=engine?engine.status().pending:0;
 if(!await ask('ログアウトしますか？',(left?'まだ家族に送れていない変更が'+left+'件あります。\n':'')+(session?.user?.is_anonymous?'Googleなしの参加情報は失われます。戻るには作成者から再招待が必要です。\n':'')+'ログアウトしますか？この端末の在庫はそのまま残ります。','ログアウト'))return;
 const token=session?.access_token;
 request('/auth/v1/logout?scope=local',{},token).catch(()=>{});
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
 if(top&&!$('atkHouseholdChip')){const chip=el('button',{type:'button',id:'atkHouseholdChip',class:'atk-household-chip',hidden:'',onclick:open});const slot=doc.querySelector('.atk-home-sharing');if(slot)slot.prepend(chip);else top.after(chip)}
 paint();
}

installEntry();
root.addEventListener?.('hashchange',()=>{
 if(!captureInvite()||!inviteCode)return;
 if(household){notice('すでに家族共有に参加しています。別の招待で自動的に切り替えることはありません');return}
 joinScreen();
});
if(googleAuth?.hasCallback()){
 googleAuth.finish().then(async s=>{if(s){keepSession(s);await afterSignIn()}}).catch(e=>{signIn();notice(friendly(e))});
}else if(inviteCode&&!household){joinScreen()}
else if(session&&household&&(meta.engine?.shadow||meta.engine?.pendingApply)){makeEngine();watch();setStatus(engine.status().pending?'pending':'synced');syncNow();if(inviteCode)notice('すでに家族共有に参加しています。別の招待で自動的に切り替えることはありません')}
// v49: family-wide receipt import records (supabase/migrations/20261101120000_atokore_receipt_imports.sql).
// null when this phone is not sharing; a network error is thrown so the caller can say it could not check.
// v49 2nd audit: receipt reservations always answer with {ok, reason, scope}. scope is the household and the
// user the call was made for, so a queued check is never sent to another household. reason tells apart what
// the person can act on: offline / auth (signed out or expired) / not_member / unavailable (the shared server
// does not have the receipt functions yet) / not_recorded (the server did not change the record) / error.
function receiptScope(){return household&&session?household.id+':'+session.user.id:null}
function receiptReason(e){const m=String(e&&e.message||'');if(e&&e.code==='network')return 'offline';if(e&&(e.code==='auth'||e.status===401))return 'auth';if(/not_member/.test(m))return 'not_member';if(e&&(e.code==='PGRST202'||e.status===404||/could not find the function/i.test(m)))return 'unavailable';return 'error'}
async function receiptCall(fn,args){
 const scope=receiptScope();if(!scope)return {ok:false,reason:'signed_out',scope:null};
 try{const data=await rpc(fn,args)||{};return data.ok===false?{...data,ok:false,reason:'not_recorded',scope}:{...data,ok:true,scope}}
 catch(e){return {ok:false,reason:receiptReason(e),scope}}
}
async function receiptClaim(fingerprint,force=false){return receiptCall('hh_receipt_claim',{p_fingerprint:fingerprint,p_force:!!force})}
async function receiptFinish(fingerprint,done){return receiptCall('hh_receipt_finish',{p_fingerprint:fingerprint,p_done:!!done})}
root.AtokoreHousehold=Object.freeze({prepEnabled,prepGet,prepPut,prepTick,assignmentsEnabled,assignmentFor,familyMembers,assignBuy,respondBuy,refreshAssignments,myId:()=>session?.user?.id||null,householdId:()=>household&&session?household.id:null,serverUndoEstimate,undoConfirmed,purchaseOpIdFor,refreshReceiptSupport:()=>refreshReceiptSupport(true),sharedEpoch:()=>sharedEpoch,sharedIdFor,entitlements,refreshEntitlements,receiptClaim,receiptFinish,receiptScope,localIdFor,open,syncNow,homeState,refreshChanges,capturePurchases,undoPurchases,photoScope,photoSharingEnabled,photoProtocolManaged,photoGeneralEnabled,photoTransferPlan,fetchPhoto,sharePhoto,status:()=>({...status,...(engine?engine.status():{}),timeouts:requestTimeouts})});
})(typeof globalThis!=='undefined'?globalThis:this);
