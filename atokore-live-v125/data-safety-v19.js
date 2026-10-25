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
 return {state:{items:a.out,buys:b.out,routines:c.out},history,dropped:a.dropped+b.dropped+c.dropped};
}

function exportBackup(){
 const store=storage();let history=[];
 try{history=JSON.parse(store?.getItem(HISTORY)||'[]')}catch(e){}
 const body=JSON.stringify({app:'atokore',format:1,exportedAt:new Date().toISOString(),data:current(),history},null,1);
 const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
 download(body,'atokore-backup-'+stamp+'.json','application/json');
 banner('バックアップファイルを作成しました。「ファイル」アプリなど安全な場所に保存してください。','info');
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
 if(!store){banner('この端末では保存領域を使えないため復元できません。','error');return false}
 const previous=JSON.stringify(current());
 try{store.setItem(BEFORE_RESTORE,JSON.stringify({at:Date.now(),data:JSON.parse(previous)}))}
 catch(e){banner('現在のデータを退避できなかったため、復元を中止しました（何も変更していません）。','error');return false}
 const before=JSON.parse(previous);
 assign(parsed.state);
 if(!save()){assign(before);return false}
 if(parsed.history){try{store.setItem(HISTORY,JSON.stringify(parsed.history))}catch(e){}}
 try{root.render?.()}catch(e){}
 banner('復元しました（在庫'+parsed.state.items.length+'件・買い物'+parsed.state.buys.length+'件）。'+(parsed.dropped?'形式が正しくない'+parsed.dropped+'件は読み込みませんでした。':''),'info');
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
 pick.addEventListener('click',()=>file.click());
 const status=el('p',{class:'atk-backup-status',role:'status'});
 file.addEventListener('change',()=>{
  const f=file.files&&file.files[0];if(!f)return;
  if(f.size>5*1024*1024){status.textContent='ファイルが大きすぎます（5MBまで）';return}
  f.text().then(text=>{
   const parsed=parseBackup(text);
   const message='現在のデータ（在庫'+counts.items.length+'件・買い物'+counts.buys.length+'件）を、ファイルの内容（在庫'+parsed.state.items.length+'件・買い物'+parsed.state.buys.length+'件）に置き換えます。\n現在のデータは端末内に退避し、あとで戻せます。';
   return root.AtokoreConfirm.ask('バックアップから復元しますか？',message,'復元する').then(ok=>{
    if(!ok){status.textContent='復元を中止しました';return}
    if(applyRestore(parsed))root.closeM?.();
   });
  }).catch(e=>{status.textContent=e?.message||'読み込みに失敗しました'}).finally(()=>{file.value=''});
 });
 const children=[close,el('h2',{text:'データのバックアップ'}),
  el('p',{class:'atk-backup-note',text:'在庫・買い物リスト・いつものリストは、この端末のブラウザ内だけに保存されています。機種変更やデータ消去に備えて、ときどきファイルに保存してください。'}),
  el('p',{class:'atk-backup-count',text:'現在：在庫'+counts.items.length+'件・買い物'+counts.buys.length+'件・セット'+counts.routines.length+'件'}),
  exportBtn,pick,file,status];
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
