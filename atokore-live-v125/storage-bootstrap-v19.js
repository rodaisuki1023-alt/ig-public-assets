/* Atokore v19 storage bootstrap — runs in <head> before the app reads localStorage.
 * 1) A stored value that cannot be parsed is moved aside (never deleted) so the app can start.
 *    If it cannot be set aside — or the saved data cannot even be read — nothing is written and
 *    saving is locked (window.__atokoreStorageLock), so the app can never overwrite it.
 * 2) Sandbox trials only: copy the previous trial's data once. The source keys are never modified,
 *    an unreadable newer trial never falls back to an older one, and a failed copy is rolled back.
 */
(function(root){
'use strict';
const KEY='atokoreTrialV4',HISTORY='atokoreHistoryV1';
const SOURCES=[['atokorePreviewTrialV17','atokorePreviewHistoryV17'],['atokorePreviewTrialV16','atokorePreviewHistoryV16']];
function valid(state){return !!state&&typeof state==='object'&&Array.isArray(state.items)&&Array.isArray(state.buys)&&Array.isArray(state.routines)}
function parse(raw){try{return JSON.parse(raw)}catch(e){return undefined}}

// An earlier launch may already have set this exact value aside (e.g. when removing the original
// failed); reuse that copy instead of writing another one into a nearly full storage every launch.
function existingAside(store,raw){
 try{
  if(typeof store.key!=='function')return null;
  for(let i=0;i<store.length;i++){const k=store.key(i);if(k&&k.indexOf(KEY+'Unreadable')===0&&store.getItem(k)===raw)return k}
 }catch(e){}
 return null;
}

function setAside(store,raw,notes){
 let aside=existingAside(store,raw);
 if(!aside){
  aside=KEY+'Unreadable'+Date.now();
  try{store.setItem(aside,raw);if(store.getItem(aside)!==raw)throw Error('backup mismatch')}
  catch(e){try{store.removeItem(aside)}catch(_){}notes.push({type:'locked',reason:'unreadable-backup-failed'});return false}
 }
 try{store.removeItem(KEY);if(store.getItem(KEY)!==null)throw Error('still present')}
 catch(e){notes.push({type:'locked',reason:'unreadable-not-removed',key:aside});return false}
 notes.push({type:'unreadable',key:aside});
 return true;
}

function migrate(store,notes){
 for(const [dataKey,historyKey] of SOURCES){
  let source=null;
  try{source=store.getItem(dataKey)}catch(e){notes.push({type:'migration-skipped',from:dataKey,reason:'read-failed'});return}
  if(source===null)continue;
  const state=parse(source);
  // A newer trial that exists but cannot be read stops here: never silently copy older data instead.
  if(!valid(state)){notes.push({type:'migration-skipped',from:dataKey,reason:'unreadable'});return}
  const written=[];
  try{
   store.setItem(KEY,source);written.push(KEY);
   if(store.getItem(KEY)!==source)throw Error('copy mismatch');
   const history=store.getItem(historyKey);
   if(history!==null&&store.getItem(HISTORY)===null&&Array.isArray(parse(history))){store.setItem(HISTORY,history);written.push(HISTORY)}
   store.setItem(KEY+'MigratedFrom',JSON.stringify({from:dataKey,at:Date.now(),items:state.items.length,buys:state.buys.length,routines:state.routines.length}));
   notes.push({type:'migrated',from:dataKey,items:state.items.length});
  }catch(e){
   // Only keys this copy created are removed; both were empty before (KEY was null, HISTORY checked).
   for(const k of written){try{store.removeItem(k)}catch(_){}}
   notes.push({type:'migration-failed',from:dataKey});
  }
  return;
 }
}

function run(store){
 const notes=[];
 let raw=null;
 try{raw=store.getItem(KEY)}catch(e){notes.push({type:'locked',reason:'read-failed'});return notes}
 if(raw!==null&&!valid(parse(raw))){
  if(!setAside(store,raw,notes))return notes;
  raw=null;
 }
 // Production keys are never migrated; only renamed sandbox keys copy older trial data.
 if(raw===null&&KEY.indexOf('atokorePreview')===0)migrate(store,notes);
 return notes;
}
const api=Object.freeze({run,valid,KEY});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreStorageBootstrap=api;
let store=null;try{store=root.localStorage||null}catch(e){}
if(store&&typeof document!=='undefined'){
 const notes=run(store);
 root.__atokoreBootNotes=notes;
 const lock=notes.find(n=>n.type==='locked');
 if(lock)root.__atokoreStorageLock=lock.reason;
}
})(typeof globalThis!=='undefined'?globalThis:this);
