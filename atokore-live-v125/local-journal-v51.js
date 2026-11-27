/* Atokore v51 (Work 9th, P0): atomic persistence of stock, shopping list and routines across tabs.
 *
 * Why: two tabs overwrote each other's localStorage snapshot (a three-way merge on top of re-reading
 * localStorage cannot be atomic: another process may write between the read and the write).
 *
 * How (the technical basis of the atomicity):
 *  - Every save turns this tab's change into OPERATIONS with unique ids (create / delete / add a quantity /
 *    set a field), computed against what this tab last saw. Quantities are deltas, so concurrent changes add up.
 *  - The operations are first written synchronously to this tab's own write-ahead log in localStorage
 *    (a key only this tab writes: no other writer, so no lost update), then committed in ONE IndexedDB
 *    readwrite transaction over the stores `state`, `applied` and `log`: the transaction reads the committed
 *    state, applies the operations whose ids are not yet in `applied`, and writes the new state, the applied
 *    ids and the log entry together. IndexedDB serializes readwrite transactions whose scopes overlap, across
 *    all tabs of the origin, and a transaction commits all of its writes or none (IndexedDB 3.0, "transaction
 *    lifecycle"; durability is the browser's default). So two tabs' operations can never overwrite each other,
 *    and an operation is applied exactly once (its id is committed with its effect).
 *  - Crash / tab closed before the commit: the operations are still in that tab's write-ahead log; the next
 *    start of any tab commits every log it finds (idempotent by id), then removes it.
 *  - Other tabs show a commit only after it is committed (BroadcastChannel message after `oncomplete`); they
 *    re-read the committed state and put their own not-yet-committed operations on top (never the reverse).
 *  - A state written as a whole (the family sync's server view, a restore) is a `replace` operation that names
 *    the revision it was computed from; operations committed after that revision are re-applied on top in the
 *    same transaction, so a replace can never drop another tab's change.
 *  - The family sync runs in ONE tab only (Web Locks; a lock is released by the browser when its tab closes or
 *    crashes, and the next tab takes it). Without Web Locks the shared sync does not run in this tab.
 *  - Without IndexedDB (e.g. a test harness) this module is inactive and saving works as before. If IndexedDB
 *    exists but cannot be opened or a commit fails, the operations stay in the write-ahead log (nothing shown
 *    as saved is lost) and the person is told that saving could not be confirmed.
 * A tab of an older version writes the data key directly: that write is never adopted silently; it is kept
 * aside (KEY + 'OldTabWrite') and the person is told.
 */
(function(root){
'use strict';
const KEY='atokoreTrialV4',DB=KEY+':journal-v51',WAL_PREFIX=KEY+':wal:',OLD_TAB=KEY+'OldTabWrite',SUM=KEY+':jsum',MARK='_jrev';
const COLS=['items','buys','routines'],COUNTERS=['qty','usage'],LOG_KEEP=500;
const idb=(()=>{try{return root.indexedDB||null}catch(_){return null}})();
const ls=()=>{try{return root.localStorage||null}catch(_){return null}};
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uid=()=>{try{return root.crypto.randomUUID()}catch(_){return 'j-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}};
const TAB=uid();
const valid=s=>!!s&&typeof s==='object'&&COLS.every(k=>Array.isArray(s[k]));
const strip=s=>{const o={...s};delete o[MARK];return o};

// ---- operations ------------------------------------------------------------------------------------
function diffOps(prev,next){
 const ops=[];
 for(const c of COLS){
  const A=new Map((prev?.[c]||[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),x])),B=new Map((next?.[c]||[]).filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
  for(const [id,row] of B){
   const old=A.get(id);
   if(!old){ops.push({id:uid(),c,r:id,t:'create',row:clone(row)});continue}
   for(const f of new Set([...Object.keys(old),...Object.keys(row)])){
    if(f==='id')continue;
    if(COUNTERS.includes(f)&&Number.isFinite(+old[f])&&Number.isFinite(+row[f])&&typeof row[f]!=='string'){const d=+row[f]-(+old[f]);if(d)ops.push({id:uid(),c,r:id,t:'add',f,d});continue}
    if(!same(old[f],row[f]))ops.push({id:uid(),c,r:id,t:'set',f,v:row[f]===undefined?null:clone(row[f]),u:row[f]===undefined});
   }
  }
  for(const id of A.keys())if(!B.has(id))ops.push({id:uid(),c,r:id,t:'delete'});
 }
 for(const f of new Set([...Object.keys(prev||{}),...Object.keys(next||{})])){
  if(COLS.includes(f)||f===MARK)continue;
  if(!same(prev?.[f],next?.[f]))ops.push({id:uid(),t:'top',f,v:next?.[f]===undefined?null:clone(next[f]),u:next?.[f]===undefined});
 }
 return ops;
}
function applyOp(s,op){
 if(op.t==='top'){if(op.u)delete s[op.f];else s[op.f]=clone(op.v);return}
 const list=s[op.c];if(!Array.isArray(list))return;
 const i=list.findIndex(x=>x&&String(x.id)===op.r);
 if(op.t==='create'){if(i<0)list.push(clone(op.row));return}
 if(i<0)return;                                  // removed meanwhile: a removal wins
 if(op.t==='delete'){list.splice(i,1);return}
 const row=list[i];
 if(op.t==='add'){row[op.f]=Math.max(0,Math.round(((+row[op.f]||0)+op.d)*1000)/1000);return}
 if(op.t==='set'){if(op.u)delete row[op.f];else row[op.f]=clone(op.v)}
}
function applyAll(data,ops){const s=clone(data);for(const o of ops)if(o.t!=='replace')applyOp(s,o);return s}

// ---- state of this tab -------------------------------------------------------------------------------
let db=null,active=false,failed=false,committed=null,pending=[],base=null,flushing=null,timer=null,leader=null;
const listeners=new Set();
const channel=(()=>{try{return new root.BroadcastChannel('atokore-journal-v51')}catch(_){return null}})();
function writeWal(){
 const store=ls();if(!store)throw Error('storage unavailable');
 const k=WAL_PREFIX+TAB;
 if(pending.length){const raw=JSON.stringify({tab:TAB,at:Date.now(),ops:pending});store.setItem(k,raw);if(store.getItem(k)!==raw)throw Error('verify')}
 else store.removeItem(k);
}
let writingCache=false;
// The cache other code reads synchronously. Its digest is written FIRST (SUM), so a tab receiving the storage
// event of the cache can tell a write of this version (digest matches) from an older version's write.
function digest(raw){let h=0x811c9dc5;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return raw.length+'.'+h.toString(36)}
// strict: a failure is reported (the save that produced it is then refused, as before the journal).
function writeCache(data,{strict=false,onlyIfPresent=false}={}){
 const store=ls();if(!store){if(strict)throw Error('storage unavailable');return}
 writingCache=true;
 try{
  if(onlyIfPresent&&store.getItem(KEY)===null)return;     // a first run stays a first run until something is saved
  const raw=JSON.stringify(strip(data));
  if(store.getItem(KEY)!==raw){store.setItem(SUM,digest(raw));store.setItem(KEY,raw);if(strict&&store.getItem(KEY)!==raw)throw Error('verify')}
 }catch(e){if(strict)throw e;root.console?.warn?.('あとこれ 表示用の保存',e)}
 finally{writingCache=false}
}
function replayView(){
 // committed + this tab's pending (a pending replace stands for the whole state, then what follows it)
 let s=clone(committed?committed.data:base||{items:[],buys:[],routines:[]});
 for(const o of pending){if(o.t==='replace')s=clone(o.data);else applyOp(s,o)}
 return s;
}
// The app keeps items / buys / routines as script-level bindings of the page (shared by classic scripts).
function assignMemory(s){try{items=s.items;buys=s.buys;routines=s.routines}catch(_){}}
function memory(){try{return {items,buys,routines}}catch(_){return null}}
function banner(msg){try{root.AtokoreDataSafety?.notify?.(msg,'error')}catch(_){}}

// ---- IndexedDB -------------------------------------------------------------------------------------------
function open(){
 return new Promise((resolve,reject)=>{
  const r=idb.open(DB,1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('state');d.createObjectStore('applied');d.createObjectStore('log')};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('idb open'));r.onblocked=()=>reject(Error('idb blocked'));
 });
}
// The one atomic step: apply operations (by id, once) to the committed state, in one readwrite transaction.
function commit(ops,{init=null}={}){
 return new Promise((resolve,reject)=>{
  let tx;try{tx=db.transaction(['state','applied','log'],'readwrite')}catch(e){reject(e);return}
  const st=tx.objectStore('state'),ap=tx.objectStore('applied'),lg=tx.objectStore('log');
  let result=null;
  const g=st.get('main');
  g.onsuccess=()=>{
   let cur=g.result;
   if(!cur){cur={rev:0,data:init&&valid(init)?strip(clone(init)):{items:[],buys:[],routines:[]}};}
   const ids=ops.map(o=>o.id),seen=new Set();let i=0;const fresh=[];
   const next=()=>{
    if(i<ids.length){const q=ap.get(ids[i]);q.onsuccess=()=>{if(q.result!==undefined)seen.add(ids[i]);i++;next()};return}
    let data=clone(cur.data);
    const todo=ops.filter(o=>!seen.has(o.id));
    const finish=()=>{
     const rev=cur.rev+(todo.length||!g.result?1:0);
     st.put({rev,data},'main');
     for(const o of todo)ap.put(rev,o.id);
     if(todo.length)lg.put({rev,ops:todo.filter(o=>o.t!=='replace')},rev);
     if(rev>LOG_KEEP)lg.delete(IDBKeyRange.upperBound(rev-LOG_KEEP));
     result={rev,data};
    };
    // A replace names the revision it was computed from; what was committed after it is applied on top.
    const step=k=>{
     if(k>=todo.length){finish();return}
     const o=todo[k];
     if(o.t!=='replace'){applyOp(data,o);step(k+1);return}
     data=strip(clone(o.data));
     if(!(Number.isSafeInteger(o.ifRev)&&o.ifRev<cur.rev)){step(k+1);return}
     // ...except the operations the replaced state already contained (this tab's, named by the replace).
     const skip=new Set(Array.isArray(o.has)?o.has:[]);
     const q=lg.getAll(IDBKeyRange.lowerBound(o.ifRev+1));
     q.onsuccess=()=>{for(const e of q.result||[])for(const x of e.ops||[])if(!skip.has(x.id))applyOp(data,x);step(k+1)};
    };
    step(0);
   };
   next();
  };
  tx.oncomplete=()=>resolve(result);
  tx.onabort=tx.onerror=()=>reject(tx.error||Error('idb commit'));
 });
}
function readCommitted(){
 return new Promise((resolve,reject)=>{
  let tx;try{tx=db.transaction(['state'],'readonly')}catch(e){reject(e);return}
  const g=tx.objectStore('state').get('main');
  g.onsuccess=()=>resolve(g.result||null);g.onerror=()=>reject(g.error);
 });
}
function walKeys(){const store=ls();if(!store)return [];return Object.keys(store).filter(k=>k.startsWith(WAL_PREFIX))}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(!flushing)void flushOnce();else void flush()},0)}
// Resolves when everything this tab recorded so far is committed (or the commit failed).
async function flush(){
 for(;;){
  if(!active||!db)return committed;
  if(flushing){await flushing;if(!pending.length||failed)return committed;continue}
  if(!pending.length)return committed;
  await flushOnce();
  if(failed)return committed;
 }
}
function flushOnce(){
 flushing=(async()=>{
  try{
   while(pending.length){
    const batch=pending.slice();
    const res=await commit(batch);
    committed=res;
    const done=new Set(batch.map(o=>o.id));
    pending=pending.filter(o=>!done.has(o.id));
    writeWal();
    failed=false;
    try{channel?.postMessage({rev:committed.rev,tab:TAB})}catch(_){}
    for(const f of listeners)try{f({own:true,rev:committed.rev})}catch(_){}
   }
   // This tab now shows the committed state (with what other tabs committed) plus its own uncommitted work.
   const v=replayView();
   if(!same(v,memory())){base=clone(v);assignMemory(v);setTimeout(()=>{try{root.render?.()}catch(_){}} ,0)}
   writeCache(v,{onlyIfPresent:true});
  }catch(e){
   failed=true;
   root.console?.error?.('あとこれ: 保存の確定',e);
   banner('保存を確定できませんでした（変更はこの端末に残っています）。空き容量を確認してください。次の操作または再読み込みでやり直します。');
  }finally{flushing=null}
  return committed;
 })();
 return flushing;
}
async function refreshFromOther(){
 if(!active||!db)return;
 const cur=await readCommitted();
 if(!cur||(committed&&cur.rev<=committed.rev))return;
 committed=cur;
 const s=replayView();base=clone(s);assignMemory(s);writeCache(s);
 for(const f of listeners)try{f({own:false,rev:cur.rev})}catch(_){}
 setTimeout(()=>{try{root.render?.()}catch(_){}} ,0);
}

// ---- public: used by data-safety save() and the family sync ------------------------------------------
/** A save of this tab: record the change as operations (durable now), commit soon. false = not saved. */
function capture(current,{cached=false}={}){
 if(!active)return null;                         // inactive: the caller saves as before
 if(failed&&!db)return false;                     // the store cannot be opened: refuse, never pretend
 const ops=diffOps(base,current);
 if(!ops.length){if(!cached){try{writeCache(current,{strict:true})}catch(e){return false}}return true}
 const before=pending.slice();
 pending=pending.concat(ops);
 try{writeWal()}catch(e){pending=before;return false}
 // The cache other code reads at once must hold the change too; if this device cannot write it, the save is
 // refused and the operations are taken back out of the log (nothing half-saved).
 try{if(!cached)writeCache(current,{strict:true});else ls().setItem(SUM,digest(JSON.stringify(strip(current))))}
 catch(e){pending=before;try{writeWal()}catch(_){}return false}
 base=clone(current);
 schedule();
 return true;
}
/** What this tab shows: the committed state plus its own uncommitted operations, with the revision and the
 * ids of those operations (a state computed from this view names them, see replace()). */
function view(){return {data:replayView(),rev:committed?committed.rev:null,has:pending.filter(o=>o.t!=='replace').map(o=>o.id)}}
/** A whole state computed from `ifRev` plus the operations `has` (the family sync's server view, a restore).
 * Operations committed after `ifRev` that are not in `has` (other tabs') are applied on top when committed. */
function replace(data,ifRev,has){
 if(!active)return null;
 if(failed&&!db)return false;
 // Without a known revision (the store not open yet) nothing is re-applied: never "everything since revision 0".
 const op={id:uid(),t:'replace',data:strip(clone(data)),ifRev:Number.isSafeInteger(ifRev)?ifRev:(committed?committed.rev:null),has:Array.isArray(has)?has.slice(0,5000):pending.filter(o=>o.t!=='replace').map(o=>o.id)};
 const before=pending.slice();
 pending=pending.concat([op]);
 try{writeWal()}catch(e){pending=before;return false}
 const s=replayView();base=clone(s);assignMemory(s);writeCache(s);
 schedule();
 return true;
}
async function init(){
 if(!idb){active=false;return false}
 // The saved data could not be read nor set aside (storage-bootstrap): every save stays refused and nothing
 // here writes anything (data-safety keeps the lock).
 if(root.__atokoreStorageLock){active=false;return false}
 const store=ls();
 const rawKey=store?.getItem(KEY)??null;
 let legacy=null;try{legacy=JSON.parse(rawKey||'null')}catch(_){legacy=undefined}
 if(rawKey!==null&&!valid(legacy)){active=false;return false}         // unreadable: never overwritten
 try{
  db=await open();
  // First start with the journal: the existing data becomes revision 1 (idempotent: only when none exists).
  const cur=await readCommitted();
  if(!cur)committed=await commit([],{init:valid(legacy)?legacy:{items:root.items||[],buys:root.buys||[],routines:root.routines||[]}});
  else committed=cur;
  // Operations of tabs that closed or crashed before committing (and this tab's from a previous load).
  const logs=[];
  for(const k of walKeys()){try{const raw=store.getItem(k),w=JSON.parse(raw||'null');if(Array.isArray(w?.ops))logs.push({k,raw,ops:w.ops})}catch(_){}}
  if(logs.length){
   committed=await commit(logs.flatMap(l=>l.ops));
   // Only a log that did not change since it was read is removed: a tab still open may have added an
   // operation meanwhile (it stays in its log and is committed by that tab, or here next time; ids make
   // a second commit of the same operation a no-op).
   for(const l of logs)try{if(store.getItem(l.k)===l.raw)store.removeItem(l.k)}catch(_){}
   try{channel?.postMessage({rev:committed.rev,tab:TAB})}catch(_){}     // other open tabs show the recovered change
  }
  // A cache written by an older version of the app (no revision mark) that differs from the committed data
  // is kept aside, never adopted silently.
  // The data key was removed (reset, cleared site data) while the journal still has a state: start from what
  // the page has (a removal is the person's or the app's own decision; nothing else removes the key).
  if(cur&&legacy===null&&!logs.length&&!same(committed.data,memory()||{items:[],buys:[],routines:[]}))committed=await commit([{id:uid(),t:'replace',data:memory()||{items:[],buys:[],routines:[]},ifRev:committed.rev}]);
  // A cache written by an older version of the app (its digest does not match) that differs from the committed
  // data is kept aside, never adopted silently.
  // A cache of THIS version that differs is never adopted either: every change it holds was written to a
  // log before the cache (capture/replace) and was committed above, so a difference can only be an older
  // write that arrived late (two tabs saving at once: the slower tab's cache from before the other's
  // commit). Adopting it replaced the newer committed state and lost an operation (Work 10th, CI WebKit);
  // the cache is rewritten from the committed state below instead.
  else if(valid(legacy)&&cur&&!same(strip(legacy),committed.data)){
   const raw=store.getItem(KEY);
   if(store.getItem(SUM)!==digest(raw||''))try{store.setItem(OLD_TAB,raw)}catch(_){}
  }
  const s=replayView();base=clone(s);assignMemory(s);
  if(pending.length)schedule();else writeCache(s,{onlyIfPresent:true});
  setTimeout(()=>{try{root.render?.()}catch(_){}} ,0);
  channel&&(channel.onmessage=e=>{if(e.data?.tab!==TAB)void refreshFromOther()});
  // A write of the data key by another tab: if it carries no revision mark it is an older version's write.
  root.addEventListener?.('storage',e=>{
   if(e.key!==KEY||e.newValue==null)return;
   let v=null;try{v=JSON.parse(e.newValue)}catch(_){return}
   if(valid(v)&&store.getItem(SUM)!==digest(e.newValue)){
    try{store.setItem(OLD_TAB,e.newValue)}catch(_){}
    banner('古い版の画面で保存された変更があります。この画面の内容は変えていません。古い画面を閉じてから、再読み込みしてください。');
    writeCache(replayView());
   }else void refreshFromOther();
  });
  electLeader();
  return true;
 }catch(e){
  failed=true;db=null;
  root.console?.error?.('あとこれ: 保存領域（IndexedDB）を開けません',e);
  banner('この端末の保存領域を開けないため、変更を保存できません。プライベートブラウズや空き容量を確認してください。');
  return false;
 }
}
// The family sync runs in one tab (Web Locks). The lock is held for the life of the tab.
let leaderResolve;const leaderReady=new Promise(r=>leaderResolve=r);
function electLeader(){
 const locks=root.navigator?.locks;
 if(!locks?.request){leader=false;leaderResolve(false);return}
 locks.request('atokore-sync-leader-v51',{ifAvailable:true},lock=>{
  if(!lock){
   leader=false;leaderResolve(false);
   locks.request('atokore-sync-leader-v51',()=>{leader=true;for(const f of listeners)try{f({leader:true})}catch(_){}return new Promise(()=>{})});
   return;
  }
  leader=true;leaderResolve(true);
  return new Promise(()=>{});
 }).catch(()=>{leader=false;leaderResolve(false)});
}
// Any other code of THIS tab that writes the data key directly (not through save()) is recorded the same way.
try{
 const proto=root.Storage?.prototype,orig=proto?.setItem;
 if(idb&&orig&&!orig.__atokoreJournal){
  const observed=function(k,v){
   const r=orig.apply(this,arguments);
   if(k===KEY&&!writingCache&&active&&this===ls()){let d=null;try{d=JSON.parse(String(v))}catch(_){}if(valid(d))capture(d,{cached:true})}
   return r;
  };
  observed.__atokoreJournal=true;proto.setItem=observed;
 }
}catch(_){}
// Active from the first moment (before IndexedDB has opened): saves are recorded against the data the page
// loaded with and committed once the store is open.
if(idb&&!root.__atokoreStorageLock){active=true;base=clone(memory()||{items:[],buys:[],routines:[]})}
const ready=init();
root.AtokoreJournal=Object.freeze({
 ready,capture,replace,flush,view,
 active:()=>active,failed:()=>failed,
 committedRev:()=>committed?committed.rev:null,
 committedData:()=>committed?clone(committed.data):null,
 readStored:async()=>{if(!db)return null;const c=await readCommitted();return c?clone(c.data):null},
 pendingCount:()=>pending.length,
 isLeader:()=>leader,leaderReady:()=>leaderReady,
 onChange:f=>{listeners.add(f);return()=>listeners.delete(f)},
 _diffOps:diffOps,_applyAll:applyAll,_writingCache:()=>writingCache,tab:TAB,
});
})(typeof globalThis!=='undefined'?globalThis:this);
