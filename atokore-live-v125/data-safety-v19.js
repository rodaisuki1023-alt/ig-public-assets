/* Atokore v19 data safety — loaded right after the inline app script, before every other module.
 * - save() returns false instead of pretending to succeed, and puts the in-memory state back to
 *   what is actually stored, so nothing on screen claims a change that will vanish on reload.
 * - Backup to a JSON file and restore from it (the current data is set aside first).
 * Everything is built with DOM APIs and textContent; no user data is parsed as HTML here.
 */
(function(root){
'use strict';
const KEY='atokoreTrialV4',HISTORY='atokoreHistoryV1',BEFORE_RESTORE=KEY+'BeforeRestore';
const doc=typeof document==='undefined'?null:document;
const valid=s=>!!s&&typeof s==='object'&&Array.isArray(s.items)&&Array.isArray(s.buys)&&Array.isArray(s.routines);
function storage(){try{return root.localStorage||null}catch(e){return null}}
function current(){return {items,buys,routines}}
function assign(state){items=state.items;buys=state.buys;routines=state.routines}
// Used only when nothing was ever persisted (first launch): the state the app started with.
let firstState=null;try{firstState=JSON.stringify(current())}catch(e){}

function storedState(){
 let raw=null;try{raw=storage()?.getItem(KEY)??null}catch(e){}
 try{const s=JSON.parse(raw);if(valid(s))return s}catch(e){}
 try{const s=JSON.parse(firstState);if(valid(s))return s}catch(e){}
 return null;
}

function banner(message,kind){
 if(!doc)return;
 let node=doc.getElementById('atkSafetyBanner');
 if(!node){
  node=doc.createElement('div');node.id='atkSafetyBanner';node.setAttribute('role','alert');
  const text=doc.createElement('span');text.className='atk-safety-text';
  const close=doc.createElement('button');close.type='button';close.className='atk-safety-close';close.textContent='閉じる';
  close.addEventListener('click',()=>node.classList.remove('on'));
  node.append(text,close);doc.body.appendChild(node);
 }
 node.dataset.kind=kind||'error';
 node.querySelector('.atk-safety-text').textContent=message;
 node.classList.add('on');
 clearTimeout(banner.timer);banner.timer=setTimeout(()=>node.classList.remove('on'),kind==='info'?4500:8000);
}

// Set by storage-bootstrap-v19.js when the saved data could neither be read nor set aside:
// writing now would overwrite the only copy, so every save path refuses until reload.
const LOCK_MESSAGE='以前の保存データを読み込めず、退避もできなかったため、元のデータを守るために保存を止めています。端末の空き容量を増やしてから再読み込みしてください。マイページ「データのバックアップ」から元のデータをファイルに保存できます。';
const locked=()=>!!root.__atokoreStorageLock;
function assertWritable(){if(locked())throw Error(LOCK_MESSAGE)}

function save(){
 const store=storage();
 try{
  assertWritable();
  if(!store)throw Error('storage unavailable');
  store.setItem(KEY,JSON.stringify(current()));
  return true;
 }catch(e){
  root.__atokoreSaveFailures=(root.__atokoreSaveFailures||0)+1;
  const stored=storedState();
  if(stored)assign(stored);
  banner(locked()?LOCK_MESSAGE:'保存できませんでした。変更は取り消し、保存済みの内容に戻しました。端末の空き容量やプライベートブラウズ設定を確認してください。','error');
  setTimeout(()=>{try{root.render?.()}catch(_){}} ,0);
  try{root.console?.error?.('あとこれ: 保存に失敗しました',e)}catch(_){}
  return false;
 }
}
root.save=save;

function cleanList(list,keep){
 let dropped=0;const out=[];
 for(const x of Array.isArray(list)?list:[]){if(keep(x))out.push(x);else dropped++}
 return {out,dropped};
}
const okName=x=>!!x&&typeof x==='object'&&typeof x.name==='string'&&x.name.trim()&&x.name.length<=120;
const okRecord=x=>okName(x)&&Number.isFinite(Number(x.qty))&&Number.isFinite(Number(x.id));
const okRoutine=x=>okName(x)&&Number.isFinite(Number(x.id))&&Array.isArray(x.items)&&x.items.every(okRecord);

function parseBackup(text){
 let data;try{data=JSON.parse(text)}catch(e){throw Error('ファイルを読み込めませんでした（JSON形式ではありません）')}
 const state=data&&data.app==='atokore'&&data.data?data.data:data;
 if(!valid(state))throw Error('あとこれのバックアップファイルではありません');
 const a=cleanList(state.items,okRecord),b=cleanList(state.buys,okRecord),c=cleanList(state.routines,okRoutine);
 const history=Array.isArray(data?.history)?data.history.filter(h=>h&&typeof h==='object'&&typeof h.title==='string').slice(0,200):null;
 const createdAt=typeof data?.exportedAt==='string'&&!Number.isNaN(Date.parse(data.exportedAt))?data.exportedAt:null;
 return {state:{items:a.out,buys:b.out,routines:c.out},history,dropped:a.dropped+b.dropped+c.dropped,createdAt,photos:Array.isArray(data?.photos)?data.photos:[]};
}

const photosApi=()=>root.AtokoreProductPhotos;
// Product photos are part of the backup (format 2). Saving a backup is always possible, also while
// sharing with the family.
async function exportBackup(){
 const store=storage();let history=[];
 try{history=JSON.parse(store?.getItem(HISTORY)||'[]')}catch(e){}
 const data=JSON.parse(JSON.stringify(current()));
 let photos=[],missing=0;
 try{if(photosApi()?.exportPhotos)({photos,missing}=await photosApi().exportPhotos(data.items))}catch(e){missing=-1}
 const body=JSON.stringify({app:'atokore',format:2,exportedAt:new Date().toISOString(),data,history,photos},null,1);
 const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
 download(body,'atokore-backup-'+stamp+'.json','application/json');
 banner('バックアップファイルを作成しました（写真'+photos.length+'枚を含みます）。'+(missing?'写真'+(missing>0?missing+'枚':'の一部')+'は読み込めなかったため含めていません（通信を確認してもう一度保存してください）。':'')+'「ファイル」アプリなど安全な場所に保存してください。',missing?'error':'info');
}

function download(body,name,type){
 const url=URL.createObjectURL(new Blob([body],{type}));
 const a=doc.createElement('a');a.href=url;a.download=name;
 doc.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),4000);
}

function applyRestore(parsed){
 const store=storage();
 if(locked()){banner(LOCK_MESSAGE,'error');return false}
 if(root.AtokoreHousehold?.homeState?.().joined){banner('家族共有に参加している間は、ファイルから復元できません。','error');return false}
 if(!store){banner('この端末では保存領域を使えないため復元できません。','error');return false}
 const previous=JSON.stringify(current());
 try{store.setItem(BEFORE_RESTORE,JSON.stringify({at:Date.now(),data:JSON.parse(previous)}))}
 catch(e){banner('現在のデータを退避できなかったため、復元を中止しました（何も変更していません）。','error');return false}
 const before=JSON.parse(previous);
 assign(parsed.state);
 if(!save()){assign(before);return false}
 if(parsed.history){try{store.setItem(HISTORY,JSON.stringify(parsed.history))}catch(e){}}
 try{root.render?.()}catch(e){}
 const done='復元しました（ストック'+parsed.state.items.length+'件・買い物'+parsed.state.buys.length+'件・いつものリスト'+parsed.state.routines.length+'件）。'+(parsed.dropped?'形式が正しくない'+parsed.dropped+'件は読み込みませんでした。':'');
 banner(done,'info');
 // Photos follow the restored products; the current photos are set aside for "復元前に戻す".
 const photos=photosApi()?.parsePhotos?.(parsed.photos,parsed.state.items)||[];
 Promise.resolve(photosApi()?.replaceAll?.(photos)).then(()=>{try{root.render?.()}catch(e){}})
  .catch(()=>banner(done+'写真だけ復元できませんでした。端末の空き容量を確認してください。','error'));
 return true;
}

function undoRestore(){
 const store=storage();let saved=null;
 try{saved=JSON.parse(store?.getItem(BEFORE_RESTORE)||'null')}catch(e){}
 if(!saved||!valid(saved.data)){banner('戻せる退避データがありません。','error');return}
 root.AtokoreConfirm.ask('復元する前の状態に戻しますか？','端末内に退避していた、復元前の内容に戻します。','元に戻す').then(ok=>{if(ok)undoRestoreConfirmed(saved)});
}
function undoRestoreConfirmed(saved){
 const before=JSON.parse(JSON.stringify(current()));
 assign(saved.data);
 if(!save()){assign(before);return}
 try{root.render?.()}catch(e){}
 root.closeM?.();
 banner('復元前の状態に戻しました。','info');
 Promise.resolve(photosApi()?.undoReplace?.()).then(()=>{try{root.render?.()}catch(e){}}).catch(()=>banner('復元前の状態に戻しました。写真だけ戻せませんでした。','error'));
}

function el(tag,props,children){
 const node=doc.createElement(tag);
 for(const [k,v] of Object.entries(props||{})){if(k==='text')node.textContent=v;else if(k==='class')node.className=v;else node.setAttribute(k,v)}
 for(const c of children||[])node.append(c);
 return node;
}

function openBackup(){
 root.openM?.('');
 const sheet=doc.getElementById('sheet');if(!sheet)return;
 const close=el('button',{type:'button',class:'close',text:'閉じる'});close.addEventListener('click',()=>root.closeM?.());
 const counts=current();
 const exportBtn=el('button',{type:'button',class:'atk-backup-primary',text:'バックアップファイルを保存'});
 exportBtn.addEventListener('click',exportBackup);
 const file=el('input',{type:'file',accept:'application/json,.json',class:'atk-backup-file','aria-label':'バックアップファイルを選択'});
 const pick=el('button',{type:'button',class:'atk-backup-secondary',text:'バックアップから復元'});
 const status=el('p',{class:'atk-backup-status',role:'status'});
 // While sharing, restoring a file on one device would overwrite what the family shares.
 const shared=!!root.AtokoreHousehold?.homeState?.().joined;
 const blocked=el('div',{class:'atk-backup-blocked',hidden:''},[
  el('p',{text:'家族共有に参加している間は、この端末のファイルから復元できません。共有している在庫や写真が、家族の端末でも置き換わってしまうためです。'}),
  el('p',{text:'共有の内容を取り戻したいときは「共有に再接続する」、ファイルの内容に戻したいときは、共有を抜けてから復元してください。バックアップの保存はいつでもできます。'})]);
 const reconnect=el('button',{type:'button',class:'atk-backup-secondary',text:'共有に再接続する'});
 reconnect.addEventListener('click',()=>{root.closeM?.();root.AtokoreHousehold?.syncNow?.();root.AtokoreHousehold?.open?.()});
 const leaveFirst=el('button',{type:'button',class:'atk-backup-secondary',text:'共有を抜けてから復元する'});
 leaveFirst.addEventListener('click',()=>{root.closeM?.();root.AtokoreHousehold?.open?.()});
 blocked.append(reconnect,leaveFirst);
 pick.addEventListener('click',()=>{if(shared){blocked.hidden=false;status.textContent='';return}file.click()});
 file.addEventListener('change',()=>{
  const f=file.files&&file.files[0];if(!f)return;
  if(root.AtokoreHousehold?.homeState?.().joined){blocked.hidden=false;file.value='';return}
  if(f.size>20*1024*1024){status.textContent='ファイルが大きすぎます（20MBまで）';return}
  f.text().then(async text=>{
   const parsed=parseBackup(text);
   const photos=photosApi()?.parsePhotos?.(parsed.photos,parsed.state.items)||[];
   let nowPhotos=null;try{nowPhotos=await photosApi()?.countPhotos?.(counts.items)}catch(e){}
   const line=(label,a,b,u)=>label+'：現在 '+a+u+' → 復元後 '+b+u;
   const message=[
    'バックアップの作成日時：'+(parsed.createdAt?new Date(parsed.createdAt).toLocaleString('ja-JP'):'記録なし'),
    line('ストック',counts.items.length,parsed.state.items.length,'件'),
    line('買い物リスト',counts.buys.length,parsed.state.buys.length,'件'),
    line('いつものリスト',counts.routines.length,parsed.state.routines.length,'件'),
    line('写真',nowPhotos==null?'?':nowPhotos,photos.length,'枚')+'（写真もバックアップの内容に置き換わります）',
    '件数が同じでも中身が異なる場合があります。',
    '今の内容は端末内に控えとして残し、「復元する前の状態に戻す」で戻せます。'].join('\n');
   const ok=await root.AtokoreConfirm.ask('バックアップの内容に置き換えますか？',message,'置き換えて復元する');
   if(!ok){status.textContent='復元を中止しました';return}
   if(applyRestore(parsed))root.closeM?.();
  }).catch(e=>{status.textContent=e?.message||'読み込みに失敗しました'}).finally(()=>{file.value=''});
 });
 const children=[close,el('h2',{text:'データのバックアップ'}),
  el('p',{class:'atk-backup-note',text:'在庫・買い物リスト・いつものリスト・商品の写真を、ひとつのファイルに保存します。機種変更やデータ消去に備えて、ときどきファイルに保存してください。'}),
  el('p',{class:'atk-backup-count',text:'現在：在庫'+counts.items.length+'件・買い物'+counts.buys.length+'件・セット'+counts.routines.length+'件'}),
  exportBtn,
  el('p',{class:'atk-backup-warning',text:'復元すると、今の内容がバックアップの内容に置き換わります。バックアップに入っていない商品やリストは残りません。'}),
  pick,blocked,file,status];
 if(locked()){
  // The unreadable original is still in place: let the user take it out as a file.
  const raw=el('button',{type:'button',class:'atk-backup-secondary',text:'読み込めなかった元のデータをファイルに保存'});
  raw.addEventListener('click',()=>{
   let text=null;try{text=storage()?.getItem(KEY)??null}catch(e){}
   if(text===null){status.textContent='この端末では元のデータを読み出せませんでした';return}
   download(text,'atokore-unreadable-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'.txt','text/plain');
  });
  children.splice(3,0,el('p',{class:'atk-backup-status',text:LOCK_MESSAGE}),raw);
 }
 let hasUndo=false;try{hasUndo=!!storage()?.getItem(BEFORE_RESTORE)}catch(e){}
 if(hasUndo){const undo=el('button',{type:'button',class:'atk-backup-undo',text:'復元する前の状態に戻す'});undo.addEventListener('click',undoRestore);children.push(undo)}
 sheet.replaceChildren(...children);
}

function installEntry(){
 const page=doc.getElementById('pg-premium');
 if(!page||doc.getElementById('atkBackupCard'))return;
 const card=el('button',{type:'button',id:'atkBackupCard',class:'row atk-backup-card'},[
  el('span',{class:'grow'},[el('span',{class:'name',text:'データのバックアップ'}),el('span',{class:'meta',text:'ファイルに保存・ファイルから復元'})]),
  el('span',{'aria-hidden':'true',text:'›'})]);
 card.addEventListener('click',openBackup);
 const heading=page.querySelector('.section');
 if(heading)heading.after(card);else page.prepend(card);
}

function bootNotices(){
 const notes=root.__atokoreBootNotes||[];
 for(const n of notes){
  if(n.type==='unreadable')banner('以前の保存データを読み込めなかったため、削除せずに別の場所へ退避しました。','error');
  if(n.type==='migrated')banner('前の試用版のデータ（在庫'+n.items+'件）をコピーしました。前の試用版のデータはそのまま残っています。','info');
  if(n.type==='migration-failed')banner('前の試用版のデータをコピーできませんでした。前の試用版のデータは変更していません。','error');
  if(n.type==='migration-skipped')banner('前の試用版のデータを読み込めなかったため、コピーしていません。前の試用版のデータは変更していません。','error');
  if(n.type==='locked')banner(LOCK_MESSAGE,'error');
 }
}

const api=Object.freeze({parseBackup,valid,save,assertWritable});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreDataSafety=api;
root.atkOpenBackup=openBackup;
if(doc){installEntry();bootNotices()}
})(typeof globalThis!=='undefined'?globalThis:this);
